/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-20 15:46
 */
import {
    Logger,
    ChunkInfo,
    Config,
    DownloadErrorEnum,
    DownloadEvent,
    DownloadStatus,
    ErrorMessage,
    FileDescriptor,
    FileInformationDescriptor,
} from './Config';
import DownloadStatusHolder from './DownloadStatusHolder';
import DownloadWorker from './DownloadWorker';
import {EventEmitter} from 'events';
import * as FileOperator from './util/FileOperator';

export default class DownloadTask extends DownloadStatusHolder {

    private fileInfoDescriptor: FileInformationDescriptor;

    private simpleTaskId?: string;

    private descriptor: FileDescriptor;

    /**
     * 负责下载的workers数组
     */
    private workers?: DownloadWorker[];
    private progressTicktockMillis: number;
    private progressNumber: any;

    private downloadDir!: string;

    private isFromConfigFile: boolean;

    /**
     * 上一次ticktock时的进度，用来计算速度
     */
    private prevProgress: number = 0;


    constructor(fileDescriptor: FileDescriptor,
                progressTicktockMillis: number,
                fileInfoDescriptor: FileInformationDescriptor,
                isFromConfigFile: boolean) {
        super();
        this.progressTicktockMillis = progressTicktockMillis;
        this.fileInfoDescriptor = fileInfoDescriptor;
        // @ts-ignore
        this.descriptor = fileDescriptor;
        this.isFromConfigFile = isFromConfigFile;
        this.tryInit();
    }


    public getTaskId() {
        return this.descriptor.taskId;
    }

    public getDescriptor() {
        return this.descriptor;
    }

    private getSimpleTaskId() {
        // 只保留4位
        return this.getTaskId().substring(this.getTaskId().length - 4);
    }

    /**
     * 尝试状态设置为DownloadStatus.INIT
     */
    private tryInit() {
        const flag = this.compareAndSwapStatus(DownloadStatus.INIT);
        if (flag) {
            this.downloadDir = this.getDownloadDir();
            this.simpleTaskId = this.getSimpleTaskId();
            this.prevProgress = 0;
        }
        return flag;
    }

    /**
     * 尝试状态设置为DownloadStatus.DOWNLOADING并启动下载任务
     */
    public async start(): Promise<boolean> {
        const prevStatus = this.getStatus();
        const flag = this.compareAndSwapStatus(DownloadStatus.DOWNLOADING);
        if (flag) {
            const {descriptor, isFromConfigFile} = this;
            // 创建下载目录，用来存放下载块临时文件
            const created = await FileOperator.mkdirsIfNonExistsAsync(this.downloadDir).catch(async (err) => {
                await this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.CREATE_DOWNLOAD_DIR_ERROR, err));
                return false;
            });
            if (!created) {
                return false;
            }

            const skipDescribeAndDivide = isFromConfigFile || prevStatus === DownloadStatus.STOP || prevStatus === DownloadStatus.ERROR;
            const shouldAppendFile = skipDescribeAndDivide;
            // 新的任务所走的流程
            this.describeAndDivide(descriptor, skipDescribeAndDivide).then(async (d) => {
                if (!d) {
                    return;
                }
                // todo 知道了文件的类型&尺寸
                // 1. 创建download workers, 并加入任务池
                this.workers = await this.dispatchForWorkers(d, shouldAppendFile);
                // 2. 开始所有的workers
                this.tryResume(true).catch((e) => {
                    Logger.error(e);
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
        const flag = this.compareAndSwapStatus(DownloadStatus.DOWNLOADING, reentrant);
        if (flag) {
            const {workers} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker: DownloadWorker = workers[i];
                    await worker.tryStart(true);
                }
                this.startProgressTicktockLooper();
            }
            this.emit(DownloadEvent.STARTED, this.descriptor);
        }
        return flag;
    }


    /**
     * 尝试状态设置为DownloadStatus.STOP，并暂停任务
     */
    public async stop(): Promise<boolean> {
        const flag = this.compareAndSwapStatus(DownloadStatus.STOP);
        if (flag) {
            this.stopProgressTicktockLooper();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const w = workers[i];
                    await w.tryStop(false);
                }
            }
            this.emit(DownloadEvent.STOP, descriptor);
        }
        return flag;
    }

    /**
     * 尝试状态设置为DownloadStatus.CANCEL，并取消任务
     */
    public async cancel(): Promise<boolean> {
        const flag = this.compareAndSwapStatus(DownloadStatus.CANCEL);
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
            await FileOperator.deleteFileOrDirAsync(this.downloadDir);
            const outputFilePath = this.getOutputFilePath();
            if (await FileOperator.existsAsync(outputFilePath, false)) {
                await FileOperator.deleteFileOrDirAsync(outputFilePath);
            }
            this.emit(DownloadEvent.CANCELED, descriptor);
        }
        return flag;
    }


    /**
     * 设置状态为DOWNLOAD.ERROR
     */
    private async tryError(chunkIndex: number, error: ErrorMessage) {
        const flag = this.compareAndSwapStatus(DownloadStatus.ERROR);
        if (flag) {
            error.taskId = this.getTaskId();
            this.stopProgressTicktockLooper();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const w = workers[i];
                    if (i === chunkIndex) {
                        continue;
                    }
                    await w.tryError(false, error);
                }
            }
            this.emit(DownloadEvent.ERROR, descriptor, error);
        }
        return flag;
    }


    /**
     * 设置状态为DOWNLOAD.FINISH
     */
    private async tryFinish() {
        const flag = this.compareAndSwapStatus(DownloadStatus.FINISHED);
        if (flag) {
            const {workers} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker = workers[i];
                    await worker.tryFinish(false);
                }
            }
            // 删除info文件
            await this.deleteInfoFile();
            this.prevProgress = this.descriptor.contentLength;
            this.emit(DownloadEvent.FINISHED, this.descriptor);
        }
        return flag;
    }

    /**
     * 设置状态为DOWNLOAD.MERGE
     */
    private async tryMerge() {
        if (this.canAllWorkersMerge()) {
            const flag = this.compareAndSwapStatus(DownloadStatus.MERGE);
            if (flag) {
                this.stopProgressTicktockLooper();
                // 合并块文件
                await this.mergeChunks();
                this.emit(DownloadEvent.MERGE, this.descriptor);
                // 合并完成，状态设置为FINISH
                await this.tryFinish();
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
        const {progressTicktockMillis} = this;
        this.progressNumber = setInterval(() => {
            this.emit(DownloadEvent.PROGRESS, this.descriptor, this.computeCurrentProcess());
        }, progressTicktockMillis);
    }

    /**
     * 计算当前下载进度
     */
    private computeCurrentProcess(): any {
        const {progressTicktockMillis, prevProgress} = this;
        // bytes
        let progress = 0;
        this.workers && this.workers.forEach((worker) => {
            progress += worker.getProgress();
        });
        // bytes/s
        const speed = Math.round((progress - prevProgress) / (progressTicktockMillis / 1000));
        this.prevProgress = progress;
        return {
            contentLength: this.descriptor.contentLength,
            progress,
            // ms
            ticktock: progressTicktockMillis,
            speed,
        };
    }


    /**
     * 新任务
     * 分割任务额度为配置文件
     * @param descriptor
     * @param skip 是否跳过这一步
     */
    private async describeAndDivide(descriptor: FileDescriptor, skip: boolean): Promise<FileDescriptor | undefined> {
        this.printLog(`describeAndDivide-computed: skip=${skip}; ${JSON.stringify(descriptor)}`);
        if (skip) {
            return descriptor;
        }
        const {fileInfoDescriptor} = this;
        // @ts-ignore
        descriptor = await fileInfoDescriptor(descriptor).catch((err) => {
            this.tryError(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.DESCRIBE_FILE_ERROR, err));
            return undefined;
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
        const infoFile = this.getInfoFilePath();
        // @ts-ignore
        const avgChunkSize = Math.floor(contentLength / descriptor.chunks);
        const chunksInfo: ChunkInfo[] = [];
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
        descriptor.computed = {
            chunksInfo
        };
        const content = JSON.stringify(descriptor, null, 4);
        this.printLog(`describeAndDivide-computed: ${JSON.stringify(descriptor)}`);
        await FileOperator.writeFileAsync(infoFile, content);
        return descriptor;
    }


    /**
     * 根据分配的任务数据与现存的chunk文件大小, 创建或重用worker对象
     * @param descriptor
     * @param shouldAppendFile 是否接着已下载的文件块下载
     */
    private async dispatchForWorkers(descriptor: FileDescriptor, shouldAppendFile: boolean): Promise<DownloadWorker[]> {
        this.printLog(`dispatchForWorkers: shouldAppendFile=${shouldAppendFile}; ${JSON.stringify(descriptor)}`);
        const {downloadDir} = this;
        const {taskId, downloadUrl, computed, contentType} = descriptor;
        const {chunksInfo} = computed;
        const workers = this.workers || [];
        this.prevProgress = 0;
        for (let i = 0; i < chunksInfo.length; i++) {
            const chunkInfo = chunksInfo[i];
            const {index, length, from, to} = chunkInfo;
            let progress;
            if (shouldAppendFile) {
                progress = await this.existsBlockFile(index) ? await this.getBlockFileSize(index) : 0;
                this.prevProgress += progress;
            } else {
                await this.existsBlockFile(index) && await this.deleteBlockFile(index);
                progress = 0;
            }
            this.printLog(`<[chunk_${index}]Conf(from=${from}, to=${to}, length=${length}) Worker(newFrom=${from + progress}, to=${to}, remaining=${to - progress + 1})>`);
            let worker: DownloadWorker = workers[index];
            if (!worker) {
                worker = new DownloadWorker(
                    taskId,
                    downloadDir,
                    length,
                    contentType,
                    index,
                    from,
                    to,
                    progress,
                    downloadUrl
                ).on(DownloadEvent.STARTED, (chunkIndex) => {

                }).on(DownloadEvent.STOP, (chunkIndex) => {

                }).on(DownloadEvent.MERGE, async (chunkIndex) => {
                    await this.tryMerge();
                }).on(DownloadEvent.ERROR, async (chunkIndex, errorEnum) => {
                    const {workers} = this;
                    if (workers) {
                        for (let j = 0; j < workers.length; j++) {
                            if (j === chunkIndex) {
                                return;
                            }
                            await workers[j].tryStop(false);
                        }
                    }
                    await this.tryError(chunkIndex, errorEnum);
                }).on(DownloadEvent.CANCELED, (chunkIndex) => {

                });
                workers.push(worker);
            } else {
                worker.resetProgress(progress);
            }
            if (progress >= length) {
                // 表明这一块已经下载完毕，直接标记完成
                await worker.tryMerge(false);
            }
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


    private getDownloadDir() {
        const {descriptor} = this;
        return FileOperator.pathJoin(descriptor.storageDir, descriptor.taskId);
    }

    private getOutputFilePath() {
        const {descriptor} = this;
        return FileOperator.pathJoin(descriptor.storageDir, descriptor.filename);
    }

    private getChunkFile(index: number) {
        const {downloadDir, descriptor} = this;
        const chunkFilename = DownloadWorker.getChunkFilename(index);
        const chunkFilePath = FileOperator.pathJoin(downloadDir, chunkFilename);
        return {
            name: chunkFilename,
            path: chunkFilePath,
        };
    }

    private async existsBlockFile(index: number) {
        return await FileOperator.existsAsync(this.getChunkFile(index).path, false);
    }

    private async deleteBlockFile(index: number) {
        return await FileOperator.deleteFileOrDirAsync(this.getChunkFile(index).path);


    }

    private async getBlockFileSize(index: number) {
        return await FileOperator.fileLengthAsync(this.getChunkFile(index).path);
    }


    /**
     * 合并所有块文件
     */
    private async mergeChunks() {
        const {descriptor} = this;
        const outputFilePath = this.getOutputFilePath();
        this.printLog(`mergeAllBlocks into: ${outputFilePath}`);
        const writeStream: FileOperator.WriteStream = FileOperator.openWriteStream(outputFilePath);
        for (let i = 0; i < descriptor.chunks; i++) {
            if (!await this.mergeChunk(writeStream, i)) {
                break;
            }
        }
        writeStream.close();
        await FileOperator.deleteFileOrDirAsync(this.downloadDir);
        this.printLog(`merged: {filename=${outputFilePath}, length=${await FileOperator.fileLengthAsync(outputFilePath)}, expect_length=${descriptor.contentLength}`);
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
        const chunkFile = this.getChunkFile(i);
        this.printLog(`merging: ${chunkFile.path}`);
        return new Promise((resolve, reject) => {
            if (!this.canReadWriteFile()) {
                resolve(false);
                return;
            }
            const readStream = FileOperator.openReadStream(chunkFile.path);
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
            status === DownloadStatus.STOP ||
            status === DownloadStatus.CANCEL ||
            status === DownloadStatus.ERROR) {
            return false;
        }
        return true;
    }

    private printLog(...args: any[]) {
        Logger.debug(`[DownTask-${this.simpleTaskId}]`, ...args);
    }
}