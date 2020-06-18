/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:36
 */
import process from 'process';
import {
    Config,
    DownloadErrorEnum,
    DownloadEvent,
    DownloadTask,
    FileDescriptor,
    FileInformationDescriptor,
    HttpRequestOptionsBuilder,
    Logger,
    md5DownloadUrlTaskIdGenerator,
    requestMethodHeadFileInformationDescriptor,
    TaskIdGenerator,
    ErrorMessage
} from './Config';
import * as FileOperator from './util/FileOperator';


export default class DownloadTaskGroup {

    private configDir: string = '';
    private taskIdGenerator: TaskIdGenerator = md5DownloadUrlTaskIdGenerator;
    private fileInfoDescriptor: FileInformationDescriptor = requestMethodHeadFileInformationDescriptor;
    private httpRequestOptionsBuilder?: HttpRequestOptionsBuilder;
    private tasks: Map<string, DownloadTask> = new Map<string, DownloadTask>();
    private maxWorkerCount: number = 5;
    private progressTicktockMillis: number = 1000;
    private httpTimeout: number = 30000;
    private retryTimes = 10;

    public constructor() {
        process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
            let errMsg: ErrorMessage;
            if (err && err.errno === -4055) {
                errMsg = ErrorMessage.fromErrorEnum(DownloadErrorEnum.NO_SPACE_LEFT_ON_DEVICE, err);
            } else {
                errMsg = ErrorMessage.fromErrorEnum(DownloadErrorEnum.SYSTEM_ERROR, err);
            }
            this.tasks.forEach((task) => {
                // @ts-ignore
                task.tryError(-1, errMsg);
            });
        });
    }

    public configConfigDir(configDir: string) {
        this.configDir = configDir;
        return this;
    }

    public configMaxWorkerCount(maxWorkerCount: number) {
        this.maxWorkerCount = maxWorkerCount;
        return this;
    }

    public configTaskIdGenerator(taskIdGenerator: TaskIdGenerator) {
        this.taskIdGenerator = taskIdGenerator;
        return this;
    }

    public configFileInfoDescriptor(fileInfoDescriptor: FileInformationDescriptor) {
        this.fileInfoDescriptor = fileInfoDescriptor;
        return this;
    }

    public configProgressTicktockMillis(progressTicktockMillis: number) {
        this.progressTicktockMillis = progressTicktockMillis;
        return this;
    }

    public configHttpRequestOptionsBuilder(builder: HttpRequestOptionsBuilder) {
        this.httpRequestOptionsBuilder = builder;
        return this;
    }

    public configHttpTimeout(httpTimeout: number) {
        this.httpTimeout = httpTimeout;
        return this;
    }

    public configRetryTimes(retryTimes: number) {
        this.retryTimes = retryTimes;
        return this;
    }

    public getTasks() {
        const tasks: DownloadTask[] = [];
        this.tasks.forEach((task, key, map) => tasks.push(task));

        return tasks;
    }


    /**
     * 创建新的下载任务
     * @param downloadUrl
     * @param storageDir
     * @param filename
     * @param attachment 附加信息
     */
    public async newTask(
        downloadUrl: string, storageDir: string, filename: string | undefined, attachment?: any
    ): Promise<DownloadTask> {
        const {
            fileInfoDescriptor, progressTicktockMillis, maxWorkerCount,
            taskIdGenerator, httpRequestOptionsBuilder, httpTimeout, retryTimes
        } = this;
        let taskId: string = await taskIdGenerator(downloadUrl, storageDir, filename, attachment);
        let task: DownloadTask | undefined = this.getTask(taskId);
        if (!!task) {
            return task;
        }
        // @ts-ignore
        let descriptor = await this.assembly(taskId, downloadUrl, storageDir, filename, attachment, maxWorkerCount);
        task = new DownloadTask(descriptor, {
            progressTicktockMillis, fileInfoDescriptor, httpRequestOptionsBuilder, httpTimeout, retryTimes
        }, false)
            .on(DownloadEvent.FINISHED, (finishedTaskDescriptor: FileDescriptor) => {
                this.tasks.delete(finishedTaskDescriptor.taskId);
                Logger.debug(`[DownTaskGroup]DownloadEvent.FINISHED: this.tasks.size = ${this.tasks.size}`);
            })
            .on(DownloadEvent.CANCELED, (canceledTaskDescriptor: FileDescriptor) => {
                this.tasks.delete(canceledTaskDescriptor.taskId);
            });
        // task加入任务池
        this.tasks.set(descriptor.taskId, task);
        return task;
    }


    public async start(taskId: string) {
        const task = this.getTask(taskId);
        return task && await task.start();
    }

    /**
     * 暂停下载
     */
    public async stop(taskId: string) {
        const task = this.getTask(taskId);
        return task && await task.stop();
    }

    /**
     * 取消下载
     */
    public async cancel(taskId: string) {
        const task = this.getTask(taskId);
        return task && await task.cancel();
    }

    public async addTask(task: DownloadTask): Promise<boolean> {
        const tasks = this.tasks;
        if (tasks.has(task.getTaskId())) {
            return false;
        }
        tasks.set(task.getTaskId(), task);
        return true;
    }


    public async remove(taskId: string): Promise<boolean> {
        return this.tasks.delete(taskId);
    }

    /**
     * 根据id获取task
     * @param taskId
     */
    public getTask(taskId: string) {
        return this.tasks.get(taskId);
    }

    /**
     * 加载已有的配置文件
     */
    public async loadFromConfigDir(): Promise<DownloadTaskGroup> {
        const {configDir} = this;
        if (!await FileOperator.existsAsync(configDir, true)) {
            return this;
        }
        let infoFiles = await FileOperator.listSubFilesAsync(configDir).catch((e) => {
            Logger.error(e);
            return [];
        });
        infoFiles = infoFiles.filter((infoFile) => {
            return infoFile.endsWith(Config.INFO_FILE_EXTENSION);
        });
        const {fileInfoDescriptor, progressTicktockMillis, httpRequestOptionsBuilder, httpTimeout, retryTimes} = this;
        for (let i = 0; i < infoFiles.length; i++) {
            try {
                const infoFile = infoFiles[i];
                const json = await FileOperator.readFileAsync(infoFile);
                const printJson = json.toString().replace('\n', '');
                Logger.debug(`[DownTaskGroup]ConfigFile: ${infoFile}: ${printJson})`);
                const descriptor = JSON.parse(json);
                const task = new DownloadTask(descriptor, {
                    progressTicktockMillis, fileInfoDescriptor, httpRequestOptionsBuilder, httpTimeout, retryTimes
                }, true);
                this.tasks.set(task.getTaskId(), task);
                Logger.debug(`[DownTaskGroup]loadInfoFiles: taskId = ${task.getTaskId()}`);
            } catch (e) {
                // 加载一个文件出错就跳过
                Logger.warn(e);
            }
        }
        return this;
    }


    private async assembly(
        taskId: string, downloadUrl: string, storageDir: string, filename: string, attachment: any, chunks: number
    ): Promise<FileDescriptor> {
        const {configDir, maxWorkerCount, taskIdGenerator} = this;
        // 控制分块数量不至于太大, 太离谱
        if (chunks < 1) {
            chunks = 1;
        } else if (chunks > maxWorkerCount) {
            chunks = maxWorkerCount;
        }
        // @ts-ignore
        const fileDescriptor: FileDescriptor = {
            taskId,
            resume: false,
            configDir,
            downloadUrl,
            storageDir,
            filename,
            chunks,
            createTime: new Date().getTime(),
            attachment,
        };
        Logger.debug(`[DownTaskGroup]FileDescriptor:`, fileDescriptor);
        return fileDescriptor;
    }
}
