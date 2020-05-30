/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:36
 */
import Logger from './util/Logger';
import DownloadTask from './DownloadTask';
import {Config, DownloadErrorEnum, DownloadEvent, ErrorMessage,
    TaskIdGenerator, FileInformationDescriptor, ChunkInfo, FileDescriptor,
    defaultFileInformationDescriptor, defaultTaskIdGenerator} from './Config';
import * as FileOperator from './util/FileOperator';



export default class DownloadManager {

    private configDir: string = '';
    private taskIdGenerator?: TaskIdGenerator = defaultTaskIdGenerator;
    private fileInfoDescriptor: FileInformationDescriptor = defaultFileInformationDescriptor;
    private tasks: Map<string, DownloadTask> = new Map<string, DownloadTask>();
    private maxWorkerCount: number = 10;
    private progressTicktockMillis: number = 200;

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

    public deleteInfoFile(taskId: string) {

    }

    /**
     * 创建新的下载任务
     * @param downloadUrl
     * @param storageDir
     * @param filename
     * @param chunks
     */
    public async newTask(
        downloadUrl: string, storageDir: string, filename: string, chunks: number
    ): Promise<DownloadTask> {
        const {fileInfoDescriptor, progressTicktockMillis, taskIdGenerator} = this;
        let taskId: string = await taskIdGenerator(downloadUrl, storageDir, filename);
        let task = this.getTask(taskId);
        if (!!task) {
            return task;
        }
        // @ts-ignore
        let descriptor = await this.assembly(taskId, downloadUrl, storageDir, filename, chunks);
        task = new DownloadTask(descriptor, progressTicktockMillis, fileInfoDescriptor, false)
            .on(DownloadEvent.FINISHED, (finishedTaskDescriptor) => {
                this.tasks.delete(finishedTaskDescriptor.taskId);
                Logger.debug(`[DownManager]DownloadEvent.FINISHED: this.tasks.size = ${this.tasks.size}`);
            }).on(DownloadEvent.CANCELED, (canceledTaskDescriptor) => {
                this.tasks.delete(canceledTaskDescriptor.taskId);
            });
        // task加入任务池
        this.tasks.set(descriptor.taskId, task);
        return task;
    }


    public async start(taskId: string) {
        const task = this.getTask(taskId);
        if (task === undefined) {
            Logger.error(`taskId = ${taskId} not found`);
            return;
        }
        await task.start();
    }

    /**
     * 停止下载，或者暂停下载
     */
    public async stop(taskId: string) {
        const task = this.getTask(taskId);
        if (task === undefined) {
            Logger.error(`taskId = ${taskId} not found`);
            return;
        }
        await task.stop();
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
    public async loadInfoFiles() {
        const {configDir} = this;
        if (!await FileOperator.existsAsync(configDir, true)) {
            return;
        }
        let infoFiles = await FileOperator.listSubFilesAsync(configDir).catch((e) => {
            Logger.error(e);
            return [];
        });
        infoFiles = infoFiles.filter((infoFile) => {
            return infoFile.endsWith(Config.INFO_FILE_EXTENSION);
        });
        const {fileInfoDescriptor, progressTicktockMillis} = this;
        for (let i = 0; i < infoFiles.length; i++) {
            try {
                const infoFile = infoFiles[i];
                const json = await FileOperator.readFileAsync(infoFile);
                const printJson = json.toString().replace('\n', '');
                Logger.debug(`[DownManager]ConfigFile: ${infoFile}: ${printJson})`);
                const descriptor = JSON.parse(json);
                const task = new DownloadTask(descriptor, progressTicktockMillis, fileInfoDescriptor, true);
                this.tasks.set(task.getTaskId(), task);
                Logger.debug(`[DownManager]loadInfoFiles: taskId = ${task.getTaskId()}`);
            } catch (e) {
                Logger.warn(e);
            }
        }
    }


    private async assembly(taskId: string, downloadUrl: string, storageDir: string, filename: string, chunks: number): Promise<FileDescriptor> {
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
            configDir,
            downloadUrl,
            storageDir,
            filename,
            chunks,
            createTime: new Date(),
        };
        Logger.debug(`[DownManager]FileDescriptor:`, fileDescriptor);
        return fileDescriptor;
    }
}
