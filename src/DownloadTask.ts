/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-20 15:46
 */
import {
    ChunkInfo,
    CommonUtils,
    Config,
    DownloadErrorEnum,
    DownloadEvent,
    DownloadStatus,
    DownloadWorker,
    ErrorMessage,
    FileDescriptor,
    FileInformationDescriptor,
    HttpRequestOptionsBuilder,
    Logger,
} from './Config';
import DownloadStatusHolder from './DownloadStatusHolder';
import * as FileOperator from './util/FileOperator';

export interface TaskOptions {
    progressTicktockMillis: number;
    fileInfoDescriptor: FileInformationDescriptor;
    httpRequestOptionsBuilder?: HttpRequestOptionsBuilder;
    httpTimeout: number;
    retryTimes: number;
}


export default class DownloadTask extends DownloadStatusHolder {

    private simpleTaskId?: string;

    private descriptor: FileDescriptor;

    private options: TaskOptions;

    private attachment?: any;

    /**
     * 负责下载的workers数组
     */
    private workers?: DownloadWorker[];
    private progressNumber: any;

    // private downloadDir!: string;

    private isFromConfigFile: boolean;


    constructor(fileDescriptor: FileDescriptor,
                options: TaskOptions,
                isFromConfigFile: boolean,
                attachment?: any) {
        super();
        // @ts-ignore
        this.descriptor = fileDescriptor;
        this.options = options;
        this.isFromConfigFile = isFromConfigFile;
        this.attachment = attachment;
        this.tryInit();
    }


    public getTaskId() {
        return this.descriptor.taskId;
    }

    public getDescriptor() {
        return this.descriptor;
    }


    private isResume() {
        return this.descriptor.resume;
    }

    /**
     * 尝试状态设置为DownloadStatus.INIT
     */
    private tryInit() {
        const expectStatus = DownloadStatus.INIT;
        const flag = this.compareAndSwapStatus(expectStatus);
        if (flag) {
            this.simpleTaskId = CommonUtils.getSimpleTaskId(this.getTaskId());
        }
        return flag;
    }

    /**
     * 尝试状态设置为DownloadStatus.DOWNLOADING并启动下载任务
     */
    public async start(): Promise<boolean> {
        const prevStatus = this.getStatus();
        const expectStatus = DownloadStatus.DOWNLOADING;
        const flag = this.compareAndSwapStatus(expectStatus);
        if (flag) {
            const {descriptor, isFromConfigFile} = this;
            // 创建下载目录，用来存放下载块临时文件
            const created = await FileOperator.mkdirsIfNonExistsAsync(this.getDownloadDir()).catch(async (err) => {
                await this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.CREATE_DOWNLOAD_DIR_ERROR, err));
                return false;
            });
            if (!created) {
                return false;
            }
            const skipDescribeAndDivide = isFromConfigFile || prevStatus === DownloadStatus.STOPPED || prevStatus === DownloadStatus.ERROR;
            let shouldAppendFile = skipDescribeAndDivide;
            // 新的任务所走的流程
            this.describeAndDivide(descriptor, skipDescribeAndDivide).then(async (d) => {
                if (!d) {
                    return;
                }
                shouldAppendFile = shouldAppendFile && this.isResume();
                // todo 知道了文件的类型&尺寸
                // 1. 创建download workers, 并加入任务池
                this.workers = await this.dispatchForWorkers(d, shouldAppendFile);
                // 2. 开始所有的workers
                this.tryResume(true).catch((e) => {
                    Logger.error(e);
                    this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.FAILED_TO_RESUME_TASK, e))
                });
            });
        }
        return flag;
    }

    /**
     * 尝试状态设置为DownloadStatus.DOWNLOADING，并启动workers
     */
    private async tryResume(reentrant?: boolean) {
        if (await this.tryMerge()) {
            // 开始前再判断一下是不是所有块已经下载完, 如果已经下载完毕，直接合并，就不用再启动worker
            return true;
        }
        const expectStatus = DownloadStatus.DOWNLOADING;
        const flag = this.compareAndSwapStatus(expectStatus, reentrant);
        if (flag) {
            const {workers} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker: DownloadWorker = workers[i];
                    await worker.tryStart(true);
                }
                this.startProgressTicktockLooper();
            }
            this.emitEvent(expectStatus, DownloadEvent.STARTED);
            this.emitEvent(expectStatus, DownloadEvent.PROGRESS, this.computeCurrentProcess());
        }
        return flag;
    }


    /**
     * 尝试状态设置为DownloadStatus.STOP，并暂停任务
     */
    public async stop(): Promise<boolean> {
        const expectStatus = DownloadStatus.STOPPED;
        const flag = this.compareAndSwapStatus(expectStatus);
        if (flag) {
            this.stopProgressTicktockLooper();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const w = workers[i];
                    await w.tryStop(false);
                }
            }
            this.emitEvent(expectStatus, DownloadEvent.STOPPED);
        }
        return flag;
    }

    /**
     * 尝试状态设置为DownloadStatus.CANCEL，并取消任务
     */
    public async cancel(): Promise<boolean> {
        const expectStatus = DownloadStatus.CANCELED;
        const flag = this.compareAndSwapStatus(expectStatus);
        if (flag) {
            this.stopProgressTicktockLooper();
            await this.deleteInfoFile();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker = workers[i];
                    await worker.tryCancel(false);
                }
            }
            let err = await FileOperator.deleteFileOrDirAsync(this.getDownloadDir());
            const outputFilePath = this.getOutputFilePath();
            if (await FileOperator.existsAsync(outputFilePath, false)) {
                err = await FileOperator.deleteFileOrDirAsync(outputFilePath);
            }
            this.emitEvent(expectStatus, DownloadEvent.CANCELED);
        }
        return flag;
    }


    /**
     * 设置状态为DOWNLOAD.ERROR
     */
    private async tryError(chunkIndex: number, error: ErrorMessage) {
        const expectStatus = DownloadStatus.ERROR;
        const flag = this.compareAndSwapStatus(expectStatus);
        if (flag) {
            error.taskId = this.getTaskId();
            if (error.type === 'retry') {
                error.type = 'generic';
            }
            this.stopProgressTicktockLooper();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker = workers[i];
                    if (i === chunkIndex) {
                        continue;
                    }
                    console.log('callby: ' + chunkIndex, '; invoke: ' + i);
                    await worker.tryError(false, error);
                }
            }
            this.emitEvent(expectStatus, DownloadEvent.ERROR, error);
        }
        return flag;
    }


    /**
     * 设置状态为DOWNLOAD.RENAMING
     */
    private async tryRename() {
        const expectStatus = DownloadStatus.RENAMING;
        const flag = this.compareAndSwapStatus(expectStatus);
        if (flag) {
            const {descriptor} = this;
            const firstChunkFilePath = CommonUtils.getChunkFilePath(descriptor.taskId, descriptor.storageDir, 0);
            const outputFilePath = this.getOutputFilePath();
            const renameError = await FileOperator.rename(firstChunkFilePath, outputFilePath);
            if (renameError) {
                await this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.RENAME_MERGED_FILE_ERROR, renameError));
                return false;
            }
            this.printLog(`renamed: {filename=${outputFilePath}`);
            await this.tryFinish();
        }
        return flag;
    }


    /**
     * 设置状态为DOWNLOAD.FINISH
     */
    private async tryFinish() {
        const expectStatus = DownloadStatus.FINISHED;
        const flag = this.compareAndSwapStatus(expectStatus);
        if (flag) {
            const {descriptor, workers} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker = workers[i];
                    await worker.tryFinish(false);
                }
            }
            // 删除info文件
            await this.deleteInfoFile();
            const err = await FileOperator.deleteFileOrDirAsync(this.getDownloadDir());
            this.emitEvent(expectStatus, DownloadEvent.FINISHED);
        }
        return flag;
    }

    /**
     * 设置状态为DOWNLOAD.MERGE
     */
    private async tryMerge() {
        if (this.canAllWorkersMerge()) {
            const expectStatus = DownloadStatus.MERGING;
            const flag = this.compareAndSwapStatus(expectStatus);
            if (flag) {
                this.emitEvent(DownloadStatus.MERGING, DownloadEvent.PROGRESS, this.computeCurrentProcess());
                this.stopProgressTicktockLooper();
                if (!await this.canRenameMergedFile()) {
                    this.emitEvent(expectStatus, DownloadEvent.MERGE);
                    // 合并块文件
                    await this.mergeChunks();
                }
                // 合并完成，状态设置为RENAMING
                await this.tryRename();
            }
            return flag;
        }
        return false;
    }


    /**
     * 开始下载进度轮询并发送事件
     */
    private stopProgressTicktockLooper() {
        const {progressNumber} = this;
        if (progressNumber) {
            clearInterval(progressNumber);
            this.progressNumber = undefined;
        }
    }

    /**
     * 停止下载进度轮询
     */
    private startProgressTicktockLooper() {
        this.stopProgressTicktockLooper();
        const {progressTicktockMillis} = this.options;
        this.progressNumber = setInterval(() => {
            this.emitEvent(DownloadStatus.DOWNLOADING, DownloadEvent.PROGRESS, this.computeCurrentProcess());
        }, progressTicktockMillis);
    }

    /**
     * 计算当前下载进度
     */
    private computeCurrentProcess(): any {
        const {options} = this;
        const {progressTicktockMillis} = options;

        // bytes
        let progress = 0;
        let prevProgress = 0;
        const chunks: any[] = [];
        this.workers && this.workers.forEach((worker) => {
            const p = worker.getProgress();
            const speed = Math.round(p.progress - p.prevProgress / (progressTicktockMillis / 1000)) / 1000 + 'kb/s';
            chunks.push({
                percent: Math.round((p.progress / p.length) * 10000) / 100 + '%',
                speed
            });
            progress += p.progress;
            prevProgress += p.prevProgress;
        });
        // bytes/s
        const speed = Math.round((progress - prevProgress) / (progressTicktockMillis / 1000));
        return {
            contentLength: this.descriptor.contentLength,
            progress,
            // ms
            ticktock: progressTicktockMillis,
            speed,
            chunks,
        };
    }


    /**
     * 新任务
     * 分割任务额度为配置文件
     * @param descriptor
     * @param skip 是否跳过这一步
     */
    private async describeAndDivide(descriptor: FileDescriptor, skip: boolean): Promise<FileDescriptor | undefined> {
        this.printLog(`describeAndDivide-computed: skip=${skip}`);
        if (skip) {
            return descriptor;
        }
        const {fileInfoDescriptor} = this.options;
        // @ts-ignore
        descriptor = await fileInfoDescriptor(descriptor).catch((err) => {
            Logger.error(err);
            // this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.DESCRIBE_FILE_ERROR, err));
            return descriptor;
        });
        if (!descriptor) {
            return;
        }
        this.descriptor = descriptor;
        this.printLog(`prepareForNewTask: ${JSON.stringify(descriptor)}`);
        const {chunks, contentLength} = descriptor;
        if (!await FileOperator.mkdirsIfNonExistsAsync(descriptor.configDir)) {
            throw new Error(`create dir ${descriptor.configDir} failed`);
        }

        const chunksInfo: ChunkInfo[] = [];
        if (this.isResume()) {
            // 走断点续传下载逻辑
            const avgChunkSize = Math.floor(contentLength / descriptor.chunks);
            // 计算每个下载块需要下载多少字节，分割任务
            for (let i = 0; i < chunks; i++) {
                let size;
                if (i < chunks - 1) {
                    size = avgChunkSize;
                } else {
                    size = avgChunkSize + (contentLength % avgChunkSize);
                }
                chunksInfo.push({
                    index: i,
                    length: size,
                    from: avgChunkSize * i,
                    to: avgChunkSize * i + size - 1,
                });
            }
        } else {
            // 如果不支持断点续传, 就不分为多个worker
            descriptor.chunks = 1;
            chunksInfo.push({
                index: 0,
                length: -1,
                from: 0,
                to: -1,
            });
        }
        descriptor.computed = {
            chunksInfo
        };
        const infoFile = this.getInfoFilePath();
        const content = JSON.stringify(descriptor, null, 4);
        this.printLog(`describeAndDivide-computed: ${JSON.stringify(descriptor.computed)}`);
        await FileOperator.writeFileAsync(infoFile, content);
        this.emitEvent(DownloadStatus.DOWNLOADING, DownloadEvent.INITIALIZED);
        return descriptor;
    }


    /**
     * 根据分配的任务数据与现存的chunk文件大小, 创建或重用worker对象
     * @param descriptor
     * @param shouldAppendFile 是否接着已下载的文件块下载
     */
    private async dispatchForWorkers(descriptor: FileDescriptor, shouldAppendFile: boolean): Promise<DownloadWorker[]> {
        this.printLog(`dispatchForWorkers: shouldAppendFile=${shouldAppendFile}`);
        const {options} = this;
        const {taskId, downloadUrl, storageDir, computed, contentType} = descriptor;
        const {chunksInfo} = computed;
        const workers = this.workers || [];
        for (let i = 0; i < chunksInfo.length; i++) {
            const chunkInfo = chunksInfo[i];
            const {index, length, from, to} = chunkInfo;
            let worker: DownloadWorker = workers[index];
            if (!worker) {
                worker = new DownloadWorker(
                    taskId,
                    storageDir,
                    length,
                    contentType,
                    index,
                    from,
                    to,
                    downloadUrl,
                    {
                        httpRequestOptionsBuilder: options.httpRequestOptionsBuilder,
                        httpTimeout: options.httpTimeout,
                        retryTimes: options.retryTimes,
                        shouldAppendFile: shouldAppendFile,
                    }
                ).on(DownloadEvent.STARTED, (chunkIndex) => {

                }).on(DownloadEvent.STOPPED, (chunkIndex) => {

                }).on(DownloadEvent.MERGE, async (chunkIndex) => {
                    await this.tryMerge();
                }).on(DownloadEvent.ERROR, async (chunkIndex, errorEnum) => {
                    await this.tryError(chunkIndex, errorEnum);
                }).on(DownloadEvent.CANCELED, (chunkIndex) => {

                });
                // await worker.tryInit();
                workers.push(worker);
            } else {
                // worker.resetProgress(progress);
            }
            // if (this.isResume() && progress >= length) {
            //     // 表明这一块已经下载完毕，直接标记完成
            //     await worker.tryMerge(false);
            // }
        }
        return workers;
    }


    private getInfoFilePath() {
        const {descriptor} = this;
        const {taskId, downloadUrl, storageDir, filename, chunks, contentLength} = descriptor;
        return FileOperator.pathJoin(descriptor.configDir, taskId + Config.INFO_FILE_EXTENSION);
    }


    private canAllWorkersMerge() {
        const {workers} = this;
        if (!workers) {
            return false;
        }
        for (let i = 0; i < workers.length; i++) {
            if (!workers[i].canMerge()) {
                return false;
            }
        }
        return true;
    }

    private async canRenameMergedFile() {
        const {descriptor} = this;
        const firstChunkFilePath = CommonUtils.getChunkFilePath(descriptor.taskId, descriptor.storageDir, 0);
        if (await FileOperator.existsAsync(firstChunkFilePath, false)) {
            const fileLength = await FileOperator.fileLengthAsync(firstChunkFilePath);
            // @ts-ignore
            if (fileLength === parseInt(descriptor.contentLength)) {
                return true
            }
        }
        return false;
    }


    private getDownloadDir() {
        const {descriptor} = this;
        return FileOperator.pathJoin(descriptor.storageDir, descriptor.taskId);
    }

    private getOutputFilePath() {
        const {descriptor} = this;
        return FileOperator.pathJoin(descriptor.storageDir, descriptor.filename);
    }



    /**
     * 合并所有块文件
     */
    private async mergeChunks() {
        const {descriptor} = this;
        // 直接往第0个块文件中追加
        const firstChunkFilePath = CommonUtils.getChunkFilePath(descriptor.taskId, descriptor.storageDir, 0);
        this.printLog(`mergeAllBlocks into: ${firstChunkFilePath}`);
        const writeStream: FileOperator.WriteStream = FileOperator.openAppendStream(firstChunkFilePath);
        for (let i = 1; i < descriptor.chunks; i++) {
            if (this.getStatus() === DownloadStatus.FINISHED) {
                break;
            }
            if (!await this.mergeChunk(writeStream, i)) {
                break;
            }
        }
        writeStream.close();
        this.printLog(`merged: {filename=${firstChunkFilePath}, length=${await FileOperator.fileLengthAsync(firstChunkFilePath)}, expect_length=${descriptor.contentLength}`);

    }

    private async deleteInfoFile() {
        await FileOperator.deleteFileOrDirAsync(this.getInfoFilePath());
    }


    /**
     * 合并一个块文件
     * @param writeStream
     * @param i
     */
    private async mergeChunk(writeStream: FileOperator.WriteStream, i: number) {
        // @ts-ignore
        const chunkFilePath = this.workers[i].getChunkFilePath();
        this.printLog(`merging: ${chunkFilePath}`);
        return new Promise((resolve, reject) => {
            if (!this.canReadWriteFile()) {
                resolve(false);
                return;
            }
            const readStream = FileOperator.openReadStream(chunkFilePath);
            readStream.on('data', (chunk) => {
                if (!this.canReadWriteFile()) {
                    readStream.close();
                    writeStream.close();
                    resolve(false);
                    return;
                }
                FileOperator.doWriteStream(writeStream, chunk).catch((err) => {
                    readStream.close();
                    writeStream.close();
                    this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.APPEND_TARGET_FILE_ERROR, err));
                });
            });
            readStream.on('end', async () => {
                readStream.close();
                // await FileOperator.deleteFileOrDirAsync(chunkFile.path).catch((e) => {
                //     Logger.error(e);
                // });
                resolve(true);
            });
            readStream.on('error', (err) => {
                writeStream.close();
                this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.READ_CHUNK_FILE_ERROR, err));
            });
        });
    }

    private canReadWriteFile() {
        const status = this.getStatus();
        if (status === DownloadStatus.INIT ||
            status === DownloadStatus.STOPPED ||
            status === DownloadStatus.CANCELED ||
            status === DownloadStatus.ERROR) {
            return false;
        }
        return true;
    }

    private printLog(...args: any[]) {
        Logger.debug(`[DownTask-${this.simpleTaskId}]`, ...args);
    }

    /**
     * this.getStatus() === expectStatus 用来保证事件发射的时刻, 状态与事件匹配
     * @param expectStatus 与事件匹配的状态
     * @param event 事件
     * @param args
     * @return 是否成功发射事件
     */
    private emitEvent(expectStatus: DownloadStatus, event: DownloadEvent, ...args: any[]): boolean {
        if (this.getStatus() === expectStatus) {
            // 状态与事件匹配, 该事件应该被触发
            this.emit(event, this.descriptor, ...args);
            return true;
        }
        // 状态与事件不匹配, 该事件不应该被触发
        // 这种状态代表, 在事件回调通知的函数中, 用户改变了任务状态
        // 比如在Start事件回调中调用了cancel(), 那么在Start的状态逻辑中, 任务就已经被置为了其他状态
        // 则后续Start的事件通知就不应该再被用户接收, 避免用户收到错误的状态转换通知
        Logger.warn(
            `[DownTask-${this.simpleTaskId}]Event&StatusMismatch:`,
            `event=${event}, expect=${expectStatus}, current=${this.getStatus()}.`,
            `You'd better not do any status change operation in [callback] functions!`
        );
        return false;
    }
}