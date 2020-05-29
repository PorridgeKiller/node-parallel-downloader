/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-20 15:46
 */
import DownloadWorker from './DownloadWorker';
import {
    ChunkInfo,
    Config,
    DownloadErrorEnum,
    DownloadEvent,
    DownloadStatus,
    DownloadStatusHolder,
    ErrorMessage,
    FileDescriptor,
    FileInformationDescriptor,
} from './Config';
import {EventEmitter} from 'events';
import Logger from './util/Logger';
import * as FileOperator from './util/FileOperator';

export default class DownloadTask extends DownloadStatusHolder {

    private fileInfoDescriptor: FileInformationDescriptor;

    private descriptor: FileDescriptor;

    /**
     * 负责下载的workers数组
     */
    private workers: DownloadWorker[] = [];
    private progressTicktockMillis: number;
    private progressNumber: any;

    private downloadDir: string;

    private isOldTask: boolean;

    private prevProgress: number = 0;


    constructor(fileDescriptor: FileDescriptor,
                progressTicktockMillis: number,
                fileInfoDescriptor: FileInformationDescriptor,
                isOldTask: boolean) {
        super();
        this.progressTicktockMillis = progressTicktockMillis;
        this.fileInfoDescriptor = fileInfoDescriptor;
        // @ts-ignore
        this.descriptor = fileDescriptor;
        this.isOldTask = isOldTask;
        this.init();
    }


    public static async fromFileDescriptor(descriptor: FileDescriptor, progressTicktockMillis: number): Promise<DownloadTask> {
        const task = new DownloadTask(descriptor, progressTicktockMillis, null, true);
        return task;
    }


    protected init() {
        const flag = this.compareAndSwapStatus(DownloadStatus.INIT);
        if (flag) {
            this.downloadDir = this.getDownloadDir();
        }
        return flag;
    }

    public async start() {
        const flag = this.compareAndSwapStatus(DownloadStatus.DOWNLOADING);
        if (flag) {
            const {descriptor, fileInfoDescriptor, isOldTask} = this;
            // 创建下载目录，用来存放下载块临时文件
            if (!await FileOperator.mkdirsIfNonExistsAsync(this.downloadDir)) {
                Logger.warn(`DownloadDir: ${this.downloadDir} create failed`);
                this.emit(DownloadEvent.ERROR, ErrorMessage.fromErrorEnum(DownloadErrorEnum.CREATE_DOWNLOAD_DIR_FAILED));
                return;
            }
            if (!isOldTask) {
                // 新的任务所走的流程
                fileInfoDescriptor(descriptor).then(async (d) => {
                    Logger.debug('new descriptor:', descriptor);
                    d = await this.prepareForNewTask(d);
                    // todo 知道了文件的类型&尺寸
                    // 1. 创建download workers, 并加入任务池
                    this.workers = await this.dispatchWorkersForNewTask(d);
                    // 2. 开始所有的workers
                    this.resume(true).then(() => {
                        this.emit(DownloadEvent.STARTED, d);
                    }).catch((e) => {
                        Logger.error(e);
                    });
                });
            } else {
                Logger.debug('old descriptor:', descriptor);
                // 旧的任务所走的流程
                // 从文件读取, 断点续传
                this.workers = await this.dispatchWorkersForOldTask(descriptor);
                // 开始所有的workers
                this.resume(true).then(() => {
                    this.emit(DownloadEvent.STARTED, descriptor);
                }).catch((e) => {
                    Logger.error(e);
                });
            }
        }
        return flag;
    }


    public async resume(reentrant?: boolean) {
        if (await this.finish()) {
            // 开始前再判断一下是不是所有块已经下载完, 如果已经下载完毕，直接合并，就不用再启动worker
            return true;
        }
        Logger.debug(`prevStatus = ${this.getStatus()}; nextStatus = ${DownloadStatus.DOWNLOADING}`);
        const flag = this.compareAndSwapStatus(DownloadStatus.DOWNLOADING, reentrant);
        if (flag) {
            const {workers} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker: DownloadWorker = workers[i];
                    await worker.start(true);
                }
                this.startProgressTicktockLooper();
            }
        }
        Logger.debug('[DownloadTask]resume():', flag);
        return flag;
    }


    /**
     * 暂停任务
     */
    public async stop() {
        const flag = this.compareAndSwapStatus(DownloadStatus.STOP);
        if (flag) {
            this.stopProgressTicktockLooper();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const w = workers[i];
                    await w.stop(false);
                }
            }
            this.emit(DownloadEvent.STOP, descriptor);
        }
        return flag;
    }

    /**
     * 取消任务
     */
    public async cancel() {
        const flag = this.compareAndSwapStatus(DownloadStatus.CANCEL);
        if (flag) {
            this.stopProgressTicktockLooper();
            await this.deleteInfoFile();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const worker = workers[i];
                    await worker.cancel(false);
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


    public async error(chunkIndex: number, errorMessage: ErrorMessage) {
        const flag = this.compareAndSwapStatus(DownloadStatus.ERROR);
        if (flag) {
            this.stopProgressTicktockLooper();
            const {workers, descriptor} = this;
            if (workers) {
                for (let i = 0; i < workers.length; i++) {
                    const w = workers[i];
                    if (i === chunkIndex) {
                        return;
                    }
                    // Logger.debug(`[DownloadTask]OnError: invoker = ${chunkIndex}; call = ${i}`);
                    await w.error(false, errorMessage);
                }
            }
            this.emit(DownloadEvent.ERROR, descriptor, errorMessage);
        }
        return flag;
    }


    private async finish() {
        if (this.isAllWorkersFinished()) {
            const flag = this.compareAndSwapStatus(DownloadStatus.FINISHED);
            if (flag) {
                this.stopProgressTicktockLooper();
                // 合并块文件
                await this.mergeAllBlocks();
                // 删除info文件
                await this.deleteInfoFile();
                this.emit(DownloadEvent.FINISHED, this.descriptor);
                this.prevProgress = 0;
            }
            return flag;
        }
        return false;
    }


    /**
     * 计算当前下载进度
     */
    public computeCurrentProcess(): any {
        const {progressTicktockMillis, prevProgress} = this;
        let progress = 0;
        this.workers.forEach((worker) => {
            progress += worker.getProgressBytes();
        });
        const speed = Math.round((progress - prevProgress) / (progressTicktockMillis / 1000));
        Logger.debug('speed:', Math.round(speed / 1024 / 1024 * 100) / 100 + 'MB/s');
        this.prevProgress = progress;
        return {
            contentLength: this.descriptor.contentLength,
            progress,
            ticktock: progressTicktockMillis,
            speed,
        };
    }

    private stopProgressTicktockLooper() {
        const {progressNumber} = this;
        if (progressNumber) {
            clearInterval(progressNumber);
            this.progressNumber = undefined;
        }
    }

    private startProgressTicktockLooper() {
        this.stopProgressTicktockLooper();
        const {progressTicktockMillis} = this;
        this.progressNumber = setInterval(() => {
            this.emit(DownloadEvent.PROGRESS, this.computeCurrentProcess());
        }, progressTicktockMillis);
    }


    public getTaskId() {
        return this.descriptor.taskId;
    }

    /**
     * 新任务
     * 分割任务额度为配置文件
     * @param descriptor
     */
    private async prepareForNewTask(descriptor: FileDescriptor): Promise<FileDescriptor> {
        Logger.debug(`descriptor: ${descriptor}`);
        const {taskId, downloadUrl, storageDir, filename, chunks, contentLength} = descriptor;
        if (!await FileOperator.mkdirsIfNonExistsAsync(descriptor.configDir)) {
            throw new Error(`create dir ${descriptor.configDir} failed`);
        }
        const {downloadDir} = this;
        const infoFile = this.getInfoFilePath();
        Logger.debug(`[ClientParser]downloadDir = ${downloadDir}`);
        Logger.debug(`[ClientParser]infoFile = ${infoFile}`);
        // @ts-ignore
        const avgChunkSize = Math.floor(contentLength / descriptor.chunks);
        Logger.debug('avgChunkSize = ' + avgChunkSize);
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
        Logger.debug(`[ClientParser]fileDescriptor:`, content);
        await FileOperator.writeFileAsync(infoFile, content);
        return descriptor;
    }

    /**
     * 根据分配的任务数据与现存的chunk文件大小，创建worker对象
     * @param descriptor
     */
    private async dispatchWorkersForNewTask(descriptor: FileDescriptor): Promise<DownloadWorker[]> {
        const {downloadDir} = this;

        const {taskId, computed} = descriptor;
        // @ts-ignore
        const {chunksInfo} = computed;
        // 清空重置workers
        const downloadWorkers: DownloadWorker[] = [];
        for (let i = 0; i < chunksInfo.length; i++) {
            const chunkInfo = chunksInfo[i];
            const {index, length, from, to} = chunkInfo;
            if (this.existsBlockFile(index)) {
                await this.deleteBlockFile(index);
            }
            const worker: DownloadWorker = new DownloadWorker(
                taskId,
                downloadDir,
                chunkInfo.length,
                descriptor.contentType,
                index,
                from,
                to,
                descriptor.downloadUrl
            ).on(DownloadEvent.FINISHED, async (chunkIndex) => {
                await this.finish();
            }).on(DownloadEvent.ERROR, (chunkIndex, errorEnum) => {
                this.workers.forEach((w, idx) => {
                    if (idx === chunkIndex) {
                        return;
                    }
                    // Logger.debug(`[DownloadTask]OnError: invoker = ${chunkIndex}; call = ${idx}`);
                    w.stop(false);
                });
                this.error(chunkIndex, errorEnum);
            }).on(DownloadEvent.CANCELED, () => {

            }).on(DownloadEvent.STARTED, () => {

            });
            downloadWorkers.push(worker);
        }
        return downloadWorkers;
    }


    /**
     * 旧任务
     * @param descriptor
     */
    private async dispatchWorkersForOldTask(descriptor: FileDescriptor): Promise<DownloadWorker[]> {
        const {taskId, downloadUrl, storageDir, filename, computed, contentLength} = descriptor;
        const {chunksInfo} = computed;
        const {downloadDir} = this;
        const workers = [];
        for (let i = 0; i < chunksInfo.length; i++) {
            const chunkInfo = chunksInfo[i];
            const {index, length, from, to} = chunkInfo;
            let newFrom = from;
            if (await this.existsBlockFile(index)) {
                const chunkSize = await this.getBlockFileSize(index);
                newFrom = from + chunkSize;
                this.prevProgress += chunkSize;
            }
            Logger.debug(`< [chunk-${index}]info: from=${from}, to=${to}, length=${length}`);
            Logger.debug(`Worker: newFrom=${newFrom}, to=${to}, remaining=${to - newFrom + 1}>`);
            const worker: DownloadWorker = new DownloadWorker(
                taskId,
                downloadDir,
                length,
                descriptor.contentType,
                index,
                newFrom,
                to,
                downloadUrl
            );
            if (to - newFrom <= 0) {
                // 表明这一块已经下载完毕，直接标记完成
                worker.compareAndSwapStatus(DownloadStatus.FINISHED);
            } else {
                worker.on(DownloadEvent.FINISHED, async (chunkIndex) => {
                    await this.finish();
                }).on(DownloadEvent.ERROR, (chunkIndex, errorEnum) => {
                    this.workers.forEach((w, idx) => {
                        if (idx === chunkIndex) {
                            return;
                        }
                        Logger.debug(`[DownloadTask]OnError: invoker = ${chunkIndex}; call = ${idx}`);
                        w.stop(false);
                    });
                    this.error(chunkIndex, errorEnum);
                }).on(DownloadEvent.CANCELED, () => {

                }).on(DownloadEvent.STARTED, () => {

                });
            }
            workers.push(worker);
        }
        return workers;
    }


    private getInfoFilePath() {
        const {descriptor} = this;
        const {taskId, downloadUrl, storageDir, filename, chunks, contentLength} = descriptor;
        return FileOperator.pathJoin(descriptor.configDir, taskId + Config.INFO_FILE_EXTENSION);
    }


    private isAllWorkersFinished() {
        const {workers} = this;
        if (!workers) {
            return false;
        }
        for (let i = 0; i < workers.length; i++) {
            if (!workers[i].isFinished()) {
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

    public async existsBlockFile(index: number) {
        return await FileOperator.existsAsync(this.getChunkFile(index).path, false);
    }

    public async deleteBlockFile(index: number) {
        return await FileOperator.deleteFileOrDirAsync(this.getChunkFile(index).path);


    }

    public async getBlockFileSize(index: number) {
        return await FileOperator.fileLengthAsync(this.getChunkFile(index).path);
    }


    public async mergeAllBlocks() {
        const {descriptor} = this;
        const outputFilePath = this.getOutputFilePath();
        Logger.debug(`[DownloadTask]outputFilePath:`, outputFilePath);
        const writeStream: FileOperator.WriteStream = FileOperator.openWriteStream(outputFilePath);
        for (let i = 0; i < descriptor.chunks; i++) {
            if (!await this.merge(writeStream, i)) {
                break;
            }
            Logger.debug(`[DownloadTask]merged: ${i}`);
        }
        writeStream.close();
        await FileOperator.deleteFileOrDirAsync(this.downloadDir);
        Logger.debug(`[DownloadTask]merged: {filename: ${outputFilePath}, length = ${await FileOperator.fileLengthAsync(outputFilePath)}, expect_length = ${descriptor.contentLength}`);
    }

    public async deleteInfoFile() {
        await FileOperator.deleteFileOrDirAsync(this.getInfoFilePath());
    }


    private async merge(writeStream: FileOperator.WriteStream, i: number) {
        const chunkFile = this.getChunkFile(i);
        Logger.debug(chunkFile.path);
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
                    Logger.error(err);
                    readStream.close();
                    writeStream.close();
                    this.error(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.APPEND_TARGET_FILE_ERROR));
                });
            });
            readStream.on('end', async () => {
                readStream.close();
                await FileOperator.deleteFileOrDirAsync(chunkFile.path).catch((e) => {
                    Logger.error(`[1]`, e);
                });
                resolve(true);
            });
            readStream.on('error', (e) => {
                Logger.debug(e);
                writeStream.close();
                this.error(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.READ_CHUNK_FILE_ERROR));
            });
        });
    }


    // private canReadFile() {
    //     const status = this.getStatus();
    //     if (status === DownloadStatus.INIT ||
    //         status === DownloadStatus.STOP ||
    //         status === DownloadStatus.FINISHED ||
    //         status === DownloadStatus.CANCEL ||
    //         status === DownloadStatus.ERROR) {
    //         return false;
    //     }
    //     return true;
    // }


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
}