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
    ErrorMessage,
    FileDescriptor,
    FileInformationDescriptor
} from './Config';
import {EventEmitter} from 'events';
import Logger from './util/Logger';
import * as FileOperator from './util/FileOperator';

export default class DownloadTask extends EventEmitter {

    private fileInfoDescriptor: FileInformationDescriptor;

    private descriptor: FileDescriptor;

    /**
     * 负责下载的workers数组
     */
    private workers: DownloadWorker[] = [];
    private status = DownloadStatus.INIT;
    private progressTicktockMillis: number;
    private progressNumber: any;

    private downloadDir: string;

    private isOldTask: boolean;


    constructor(fileDescriptor: FileDescriptor,
                progressTicktockMillis: number,
                fileInfoDescriptor: FileInformationDescriptor,
                isOldTask: boolean) {
        super();
        this.progressTicktockMillis = progressTicktockMillis;
        this.fileInfoDescriptor = fileInfoDescriptor;
        Logger.debug(`[DownloadTask]progressTicktockMillis = `, progressTicktockMillis);
        // @ts-ignore
        this.descriptor = fileDescriptor;
        this.isOldTask = isOldTask;
        this.downloadDir = this.getDownloadDir();
        Logger.warn('constructor()');
    }


    public static async fromFileDescriptor(descriptor: FileDescriptor, progressTicktockMillis: number): Promise<DownloadTask> {
        const task = new DownloadTask(descriptor, progressTicktockMillis, null, true);
        return task;
    }




    public async start() {
        if (this.getStatus() === DownloadStatus.DOWNLOADING ||
            this.getStatus() === DownloadStatus.FINISHED ||
            this.getStatus() === DownloadStatus.CANCEL) {
            return false;
        }
        const {descriptor, fileInfoDescriptor, isOldTask} = this;
        // 创建下载目录，用来存放下载块临时文件
        if (!await FileOperator.mkdirsIfNonExistsAsync(this.downloadDir)) {
            Logger.warn(`DownloadDir: ${this.downloadDir} create failed`);
            this.emit(DownloadEvent.ERROR, ErrorMessage.fromErrorEnum(DownloadErrorEnum.CREATE_DOWNLOAD_DIR_FAILED));
            return;
        }
        // 新的任务所走的流程
        if (!isOldTask) {
            fileInfoDescriptor(descriptor).then(async (d) => {
                Logger.debug('descriptor', descriptor);
                d = await this.prepareForNewTask(d);
                // todo 知道了文件的类型&尺寸
                // 1. 创建download workers, 并加入任务池
                this.workers = await this.dispatchChunkWorkersForNewTask(d);
                // 2. 开始所有的workers
                this.resume().then(() => {
                    this.emit(DownloadEvent.STARTED, d);
                }).catch((e) => {
                    Logger.error(e);
                });
            });
        } else {
            // 从文件读取, 断点续传所走的流程
            this.workers = await this.dispatchChunkWorkersForOldTask(descriptor);
            // 2. 开始所有的workers
            this.resume().then(() => {
                this.emit(DownloadEvent.STARTED, descriptor);
            }).catch((e) => {
                Logger.error(e);
            });
        }
    }

    // public async continueDownload() {
    //     const {clientParser} = this;
    //     if (clientParser.existsInfoFile()) {
    //         clientInfo = clientParser.loadInfoFile();
    //         if (!clientInfo) {
    //             return null;
    //         }
    //     } else {
    //         clientInfo = clientParser.createInfoFile(serverInfo);
    //     }
    // }

    /**
     * 暂停任务
     */
    public async stop() {
        const flag = this.compareAndSwapStatus(DownloadStatus.STOP);
        if (flag) {
            if (this.progressNumber !== undefined) {
                clearInterval(this.progressNumber);
                this.progressNumber = undefined;
            }
            this.workers.map(async (worker) => {
                await worker.stop();
            });
        }
        return flag;
    }

    /**
     * 取消任务
     */
    public async cancel() {
        const flag = this.compareAndSwapStatus(DownloadStatus.CANCEL);
        if (flag) {
            if (this.progressNumber !== undefined) {
                clearInterval(this.progressNumber);
                this.progressNumber = undefined;
            }
            await this.deleteInfoFile();
            this.emit(DownloadEvent.CANCELED, this.descriptor);
        }
        return flag;
    }


    public async error(chunkIndex: number, errorMessage: ErrorMessage) {
        const flag = this.compareAndSwapStatus(DownloadStatus.ERROR);
        if (flag) {
            if (this.progressNumber !== undefined) {
                clearInterval(this.progressNumber);
                this.progressNumber = undefined;
            }
            this.workers.forEach((w, idx) => {
                if (idx === chunkIndex) {
                    return;
                }
                Logger.debug(`[DownloadTask]OnError: invoker = ${chunkIndex}; call = ${idx}`);
                w.error();
            });
            this.emit(DownloadEvent.ERROR, this.getTaskId(), errorMessage);
        }
        return flag;
    }


    public async resume() {
        if (this.getStatus() === DownloadStatus.DOWNLOADING ||
            this.getStatus() === DownloadStatus.FINISHED ||
            this.getStatus() === DownloadStatus.CANCEL) {
            return false;
        }
        if (await this.finish()) {
            // 开始前再判断一下是不是所有块已经下载完, 如果已经下载完毕，直接合并，就不用再启动worker
            return true;
        }
        const flag = this.compareAndSwapStatus(DownloadStatus.DOWNLOADING);
        if (flag) {
            this.workers.forEach(async (worker) => {
                await worker.start();
            });
            const {progressTicktockMillis} = this;
            if (this.progressNumber !== undefined) {
                clearInterval(this.progressNumber);
                this.progressNumber = undefined;
            }
            Logger.debug('this.progressNumber =', !!this.progressNumber, progressTicktockMillis);
            this.progressNumber = setInterval(() => {
                Logger.debug(DownloadEvent.PROGRESS, this.computeCurrentProcess());
                this.emit(DownloadEvent.PROGRESS, this.computeCurrentProcess());
            }, progressTicktockMillis);
        }
        return flag;
    }

    private async finish() {
        if (!this.isAllWorkersFinished()) {
            return false;
        }
        const flag = this.compareAndSwapStatus(DownloadStatus.FINISHED);
        if (flag) {
            if (this.progressNumber !== undefined) {
                clearInterval(this.progressNumber);
                this.progressNumber = undefined;
            }
            // 合并块文件
            await this.mergeAllBlocks();
            // 删除info文件
            await this.deleteInfoFile();
            this.emit(DownloadEvent.FINISHED, this.descriptor);
        }
        return flag;
    }

    public compareAndSwapStatus(nextStatus: DownloadStatus) {
        if (this.getStatus() === nextStatus) {
            return false;
        }
        this.status = nextStatus;
        return true;
    }

    public getStatus() {
        return this.status;
    }


    /**
     * 根据分配的任务数据与现存的chunk文件大小，创建worker对象
     * @param descriptor
     */
    private async dispatchChunkWorkersForNewTask(descriptor: FileDescriptor): Promise<DownloadWorker[]> {
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
                    Logger.debug(`[DownloadTask]OnError: invoker = ${chunkIndex}; call = ${idx}`);
                    w.stop();
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
     * 计算当前下载进度
     */
    public computeCurrentProcess(): any {
        let progress = 0;
        this.workers.forEach((worker) => {
            progress += worker.getProgressBytes();
        });
        return {
            contentLength: this.descriptor.contentLength,
            progress
        };
    }

    public getTaskId() {
        return this.descriptor.taskId;
    }

    /**
     * 新任务
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
     * 旧任务
     * @param descriptor
     */
    private async prepareForOldTask(descriptor: FileDescriptor): Promise<DownloadWorker[]> {
        const {taskId, downloadUrl, storageDir, filename, computed, contentLength} = descriptor;
        const {chunksInfo} = computed;
        const {downloadDir} = this;
        const workers = [];
        for (let i = 0; i < chunksInfo.length; i++) {
            const chunkInfo = chunksInfo[i];
            const {index, length, from, to} = chunkInfo;
            let newFrom = from;
            if (await this.existsBlockFile(index)) {
                newFrom = from + await this.getBlockFileSize(index) + 1;
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
                    if (this.isAllWorkersFinished()) {
                        if (this.progressNumber !== undefined) {
                            clearInterval(this.progressNumber);
                            this.progressNumber = undefined;
                        }
                        // 合并块文件
                        await this.mergeAllBlocks();
                        // 删除info文件
                        await this.deleteInfoFile();
                        this.emit(DownloadEvent.FINISHED, this.descriptor);
                    }
                }).on(DownloadEvent.ERROR, (chunkIndex, errorEnum) => {
                    this.workers.forEach((w, idx) => {
                        if (idx === chunkIndex) {
                            return;
                        }
                        Logger.debug(`[DownloadTask]OnError: invoker = ${chunkIndex}; call = ${idx}`);
                        w.stop();
                    });
                    this.error(chunkIndex, errorEnum);
                }).on(DownloadEvent.CANCELED, () => {

                }).on(DownloadEvent.STARTED, () => {

                });
            }
            workers.push(worker);
        }
        this.workers = workers;
        return workers;
    }

    private async dispatchChunkWorkersForOldTask(descriptor: FileDescriptor): Promise<DownloadWorker[]> {
        return await this.prepareForOldTask(descriptor);
    }


    private getInfoFilePath() {
        const {descriptor} = this;
        const {taskId, downloadUrl, storageDir, filename, chunks, contentLength} = descriptor;
        return FileOperator.pathJoin(descriptor.configDir, taskId + Config.INFO_FILE_EXTENSION);
    }


    private isAllWorkersFinished() {
        const {workers} = this;
        for (let i = 0; i < workers.length; i++) {
            const worker = workers[i];
            if (!worker.isFinished()) {
                return false;
            }
        }
        return true;
    }


    private getDownloadDir() {
        const {descriptor} = this;
        return FileOperator.pathJoin(descriptor.storageDir, descriptor.taskId);
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

    public async createBlockFile(index: number) {
        await FileOperator.createNewFile(this.getChunkFile(index).path);
    }

    public async deleteBlockFile(index: number) {
        return await FileOperator.deleteFileOrDirAsync(this.getChunkFile(index).path);


    }

    public async getBlockFileSize(index: number) {
        return await FileOperator.fileLengthAsync(this.getChunkFile(index).path);
    }

    public async mergeAllBlocks() {
        const {descriptor} = this;
        const outputFilePath = FileOperator.pathJoin(descriptor.storageDir, descriptor.filename);
        Logger.debug(`[DownloadTask]outputFilePath:`, outputFilePath);
        if (await FileOperator.existsAsync(outputFilePath, false)) {
            await FileOperator.deleteFileOrDirAsync(outputFilePath);
        }
        // FileUtils.createNewFile(outputFilePath);
        for (let i = 0; i < descriptor.chunks; i++) {
            await this.merge(outputFilePath, i);
        }
        await FileOperator.deleteFileOrDirAsync(this.downloadDir);
        Logger.debug(`[DownloadTask]merged:`, outputFilePath);
    }

    public async deleteInfoFile() {
        await FileOperator.deleteFileOrDirAsync(this.getInfoFilePath());
    }


    private async merge(destFilePath: string, i: number) {
        const chunkFile = this.getChunkFile(i);
        Logger.debug(chunkFile.path);
        return new Promise((resolve, reject) => {
            const readStream = FileOperator.openReadStream(chunkFile.path);
            readStream.on('data', (chunk) => {
                FileOperator.appendFile(destFilePath, chunk).catch((err) => {
                    readStream.close();
                    this.error(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.APPEND_TARGET_FILE_ERROR));
                });
            });
            readStream.on('end', () => {
                readStream.close();
                FileOperator.deleteFileOrDirAsync(chunkFile.path).then(() => {
                    resolve();
                });
            });
            readStream.on('error', (e) => {
                // Logger.debug('err:', chunkFile.path, e);
                readStream.close();
                this.error(-1, ErrorMessage.fromErrorEnum(DownloadErrorEnum.READ_CHUNK_FILE_ERROR));
                // FileOperator.deleteFileOrDirAsync(chunkFile.path).then(() => {
                //     resolve();
                // });
            });
        });
    }


}