/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-20 15:46
 */
import DownloadWorker from './DownloadWorker';
import {Config, DownloadErrorEnum, DownloadEvent, DownloadStatus, ErrorMessage, FileInformationDescriptor, ChunkInfo, FileDescriptor} from './Config';
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


    constructor(fileDescriptor: FileDescriptor,
                progressTicktockMillis: number,
                fileInfoDescriptor: FileInformationDescriptor) {
        super();
        this.progressTicktockMillis = progressTicktockMillis;
        this.fileInfoDescriptor = fileInfoDescriptor;
        Logger.debug(`[DownloadTask]progressTicktockMillis = `, progressTicktockMillis);
        // @ts-ignore
        this.descriptor = fileDescriptor;
        this.downloadDir = this.getDownloadDir();
    }


    public static async fromFileDescriptor(descriptor: FileDescriptor, progressTicktockMillis: number): Promise<DownloadTask> {
        const task = new DownloadTask(descriptor, progressTicktockMillis, null);
        return task;
    }

    public async start() {
        const {descriptor, fileInfoDescriptor} = this;
        if (!await FileOperator.mkdirsIfNonExistsAsync(this.downloadDir)) {
            Logger.warn(`DownloadDir: ${this.downloadDir} create failed`);
            this.emit(DownloadEvent.ERROR, ErrorMessage.fromErrorEnum(DownloadErrorEnum.CREATE_DOWNLOAD_DIR_FAILED));
            return;
        }
        fileInfoDescriptor(descriptor).then(async (d) => {
            d = await this.prepare(d);
            // todo 知道了文件的类型&尺寸
            // 1. 创建download workers, 并加入任务池
            this.workers = this.dispatchBlockWorkers(d);
            // 2. 开始所有的workers
            this.resume().then(() => {
                this.emit(DownloadEvent.STARTED, d);
            }).catch((e) => {
                Logger.error(e);
            });
        });
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

    public async cancel() {
        const flag = this.compareAndSwapStatus(DownloadStatus.CANCEL);
        if (flag) {
            if (this.progressNumber !== undefined) {
                clearInterval(this.progressNumber);
                this.progressNumber = undefined;
            }
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
            Logger.debug('this.progressNumber = ', !!this.progressNumber, progressTicktockMillis);
            this.progressNumber = setInterval(() => {
                Logger.debug(DownloadEvent.PROGRESS, this.computeCurrentProcess());
                this.emit(DownloadEvent.PROGRESS, this.computeCurrentProcess());
            }, progressTicktockMillis);
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
    public dispatchBlockWorkers(descriptor: FileDescriptor): DownloadWorker[] {
        const {downloadDir} = this;

        const {taskId, computed} = descriptor;
        // @ts-ignore
        const {chunksInfo} = computed;
        // 清空重置workers
        const downloadWorkers: DownloadWorker[] = [];
        chunksInfo.map((chunkInfo: any) => {
            const {index, length, from, to} = chunkInfo;
            if (this.existsBlockFile(index)) {
                this.deleteBlockFile(index);
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
                if (this.isAllWorkersFinished()) {
                    if (this.progressNumber !== undefined) {
                        clearInterval(this.progressNumber);
                        this.progressNumber = undefined;
                    }
                    await this.mergeAllBlocks();
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


            // 将注册到Task上的事件全部注册到Worker上
            // const eventNames = this.eventNames();
            // eventNames.forEach((eventName) => {
            //     if (eventName === DownloadEvent.FINISHED) {
            //         return;
            //     }
            //     const listeners = this.listeners(eventName);
            //     listeners.forEach((listener) => {
            //         // @ts-ignore
            //         worker.on(eventName, listener);
            //     });
            // });
            downloadWorkers.push(worker);
        });
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

    private async prepare(descriptor: FileDescriptor): Promise<FileDescriptor> {
        const {taskId, downloadUrl, storageDir, filename, chunks, contentLength} = descriptor;
        if (!await FileOperator.mkdirsIfNonExistsAsync(descriptor.configDir)) {
            throw new Error(`create dir ${descriptor.configDir} failed`);
        }
        const downloadDir = FileOperator.pathJoin(storageDir, taskId);
        const infoFile = FileOperator.pathJoin(descriptor.configDir, taskId + Config.INFO_FILE_EXTENSION);
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