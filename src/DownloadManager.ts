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

    private baseDir: string = 'temp_info';
    private taskIdGenerator?: TaskIdGenerator = defaultTaskIdGenerator;
    private fileInfoDescriptor: FileInformationDescriptor = defaultFileInformationDescriptor;
    private tasks: Map<string, DownloadTask> = new Map<string, DownloadTask>();
    private progressTicktockMillis: number = 200;


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
        const {fileInfoDescriptor, progressTicktockMillis} = this;

        // @ts-ignore
        let descriptor = await this.assembly(downloadUrl, storageDir, filename, chunks);
        const task = new DownloadTask(descriptor, progressTicktockMillis, fileInfoDescriptor);
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
        task.start();
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
        const infoFiles = await FileOperator.listSubFilesAsync(this.baseDir);
        infoFiles.filter((infoFile) => {
            return infoFile.endsWith(Config.INFO_FILE_EXTENSION);
        });

        for (let i = 0; i < infoFiles.length; i++) {
            const infoFile = infoFiles[i];
            const json = await FileOperator.readFileAsync(infoFile);
            const descriptor = JSON.parse(json);
            const task = await DownloadTask.fromFileDescriptor(descriptor, this.progressTicktockMillis);
            this.tasks.set(task.getTaskId(), task);
        }
    }


    private async assembly(downloadUrl: string, storageDir: string, filename: string, chunks: number): Promise<FileDescriptor> {
        const {baseDir, taskIdGenerator} = this;
        let taskId: string;
        if (taskIdGenerator) {
            taskId = await taskIdGenerator(downloadUrl, storageDir, filename);
        } else {
            // filename的MD5
            taskId = '';
        }
        // @ts-ignore
        const fileDescriptor: FileDescriptor = {
            taskId,
            configDir: baseDir,
            downloadUrl,
            storageDir,
            filename,
            chunks,
            createTime: new Date(),
        };
        Logger.debug(`[DownloadManager]FileDescriptor:`, fileDescriptor);
        return fileDescriptor;
    }
}
