/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:35
 */
import * as url from 'url';
import * as http from 'http';
import * as https from 'https';
import * as FileOperator from './util/FileOperator';
import {
    CommonUtils,
    DownloadErrorEnum,
    DownloadEvent,
    DownloadStatus,
    ErrorMessage,
    HttpRequestOptionsBuilder,
    Logger,
} from './Config';
import DownloadStatusHolder from './DownloadStatusHolder';

export interface WorkerOptions {
    httpRequestOptionsBuilder?: HttpRequestOptionsBuilder;
    httpTimeout: number;
    retryTimes: number;
    shouldAppendFile: boolean;
}

export default class DownloadWorker extends DownloadStatusHolder {
    private storageDir: string;
    private taskId: string;
    private simpleTaskId!: string;
    private index: number;
    private from: number = 0;
    private to: number = 0;
    private downloadUrl: string;
    private chunkFilePath: string;
    private length: number;
    private contentType: string;
    private options: WorkerOptions;

    private progress: number = 0;
    /**
     * 上一次ticktock时的进度，用来计算速度
     */
    private prevProgress: number = 0;
    private retryTimes: number = 0;
    private req: http.ClientRequest | undefined;
    private resp: http.IncomingMessage | undefined;
    private noResponseTime: number = 0;
    private writeStream?: FileOperator.WriteStream;


    constructor(taskId: string, storageDir: string, length: number, contentType: string, index: number,
                from: number, to: number, downloadUrl: string, options: WorkerOptions) {
        super();
        this.taskId = taskId;
        this.storageDir = storageDir;
        this.length = length;
        this.contentType = contentType;
        this.index = index;
        this.from = from;
        this.to = to;
        this.downloadUrl = downloadUrl;
        this.options = options;
        this.chunkFilePath = CommonUtils.getChunkFilePath(taskId, storageDir, index);
        this.tryInit();
    }


    /**
     * 设置初始化
     */
    private tryInit() {
        const flag = this.compareAndSwapStatus(DownloadStatus.INIT);
        if (flag) {
            this.simpleTaskId = CommonUtils.getSimpleTaskId(this.taskId);
            this.req = undefined;
            this.progress = 0;
            this.prevProgress = 0;
            this.noResponseTime = 0;
            // todo
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.DOWNLOADING
     * 块任务开始
     */
    public async tryStart(emit: boolean) {
        const flag = await this.compareAndSwapStatus(DownloadStatus.STARTED);
        if (flag) {
            this.retryTimes = 0;
            emit && this.emit(DownloadEvent.STARTED, this.index);
            return await this.tryResume(emit);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.DOWNLOADING
     * 块任务恢复
     */
    public async tryResume(emit: boolean) {
        const forceAppend = this.getStatus() !== DownloadStatus.INIT;
        let flag = await this.compareAndSwapStatus(DownloadStatus.DOWNLOADING, true);
        if (flag) {
            await this.prepare(forceAppend);
            if (await this.tryMerge(true)) {
                return true;
            }
            this.doDownloadRequest();
            emit && this.emit(DownloadEvent.DOWNLOADING, this.index);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.STOP
     * 块任务暂停
     */
    public async tryStop(emit: boolean) {
        const flag = this.compareAndSwapStatus(DownloadStatus.STOPPED);
        if (flag) {
            this.abortRequest();
            emit && this.emit(DownloadEvent.STOPPED, this.index);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.CANCEL
     * 块任务取消
     */
    public async tryCancel(emit: boolean) {
        const flag = this.compareAndSwapStatus(DownloadStatus.CANCELED);
        if (flag) {
            this.abortRequest();
            if (await FileOperator.existsAsync(this.getChunkFilePath(), false)) {
                await FileOperator.deleteFileOrDirAsync(this.getChunkFilePath());
            }
            emit && this.emit(DownloadEvent.CANCELED, this.index);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.ERROR
     * 块任务出错
     */
    public async tryError(emit: boolean, error: ErrorMessage) {
        let flag = await this.compareAndSwapStatus(DownloadStatus.ERROR);
        if (flag) {
            this.abortRequest();
            emit = emit || (error.type === 'retry' && this.retryTimes < this.options.retryTimes);
            if (error.type === 'retry') {
                if (this.retryTimes < this.options.retryTimes) {
                    flag = await this.tryResume(false);
                    this.retryTimes++;
                    Logger.warn(`error occurred but retry ${this.retryTimes}: ${JSON.stringify(error)}`);
                    return flag;
                } else {
                    emit = true;
                }
            }
            error.taskId = this.taskId;
            emit && this.emit(DownloadEvent.ERROR, this.index, error);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.FINISHED
     * 块任务完成
     */
    public async tryFinish(emit: boolean) {
        const flag = this.compareAndSwapStatus(DownloadStatus.FINISHED);
        if (flag) {
            emit && this.emit(DownloadEvent.FINISHED, this.index);
        }
        return flag;
    }

    public async tryMerge(emit: boolean) {
        if (this.progress >= this.length) {
            const flag = this.compareAndSwapStatus(DownloadStatus.MERGING);
            if (flag) {
                this.abortRequest();
                emit && this.emit(DownloadEvent.MERGE, this.index);
            }
            return flag;
        }
        return false;
    }

    private async prepare(forceAppend: boolean) {
        let progress;
        if (forceAppend || this.options.shouldAppendFile) {
            progress = await this.existsChunkFile() ? await this.getChunkFileSize() : 0;
        } else {
            if (await this.existsChunkFile()) {
                const err = await this.deleteChunkFile();
                if (err) {
                    await this.tryError(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.DELETE_CHUNK_FILE_ERROR, err));
                }
            }
            progress = 0;
        }
        this.noResponseTime = 0;
        this.progress = progress;
        this.prevProgress = progress;
        this.printLog(`<[chunk_${this.index}]Conf(from=${this.from}, to=${this.to}, length=${this.length}) Worker(newFrom=${this.from + progress}, to=${this.to}, remaining=${this.to - progress + 1})>`);
    }

    public getChunkFilePath() {
        const {taskId, storageDir, index} = this;
        return CommonUtils.getChunkFilePath(taskId, storageDir, index);
    }

    private async existsChunkFile() {
        return await FileOperator.existsAsync(this.getChunkFilePath(), false);
    }

    private async deleteChunkFile() {
        return await FileOperator.deleteFileOrDirAsync(this.getChunkFilePath());
    }

    private async getChunkFileSize() {
        return await FileOperator.fileLengthAsync(this.getChunkFilePath());
    }


    /**
     * 执行HTTP请求
     */
    private doDownloadRequest() {
        const {taskId, downloadUrl, index, from, to, progress, length, contentType, options} = this;
        const parsedUrl = url.parse(downloadUrl);
        let opts: http.RequestOptions = {
            method: 'GET',
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            agent: false,
            protocol: parsedUrl.protocol,
            headers: this.isResume() ? {
                Accept: contentType,
                Connection: 'keep-alive',
                Range: `bytes=${from + progress}-${to}`
            } : undefined,
        };
        this.printLog(`Started: Range: bytes=${from + progress}-${to}; progress=${this.progress}`);
        const {httpRequestOptionsBuilder} = options;
        if (httpRequestOptionsBuilder) {
            opts = httpRequestOptionsBuilder(opts, taskId, index, from, to, progress);
        }
        // 创建request
        let request;
        if ('http:' === parsedUrl.protocol) {
            request = http.request(opts);
        } else if ('https:' === parsedUrl.protocol) {
            request = https.request(opts);
        } else {
            // 不支持的协议
            this.tryError(
                true,
                ErrorMessage.fromErrorEnum(DownloadErrorEnum.UNKNOWN_PROTOCOL, new Error(`${parsedUrl.protocol}`))
            );
            return;
        }
        // 监听并发起request
        this.sendRequest(request);
    }


    /**
     * 发送request请求，并监听一系列事件
     * @param req 请求
     */
    private sendRequest(req: http.ClientRequest) {
        const {httpTimeout} = this.options;
        this.req = req;
        // 不知道为何，实际时长是两倍，15000ms = 实际30s
        req.setTimeout(httpTimeout);
        req.on('response', async (resp: http.IncomingMessage) => {
            if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) {
                this.handleResponse(resp);
            } else {
                // @ts-ignore
                await this.tryError(true, ErrorMessage.fromCustomer(resp.statusCode, resp.statusMessage, 'generic',
                    new Error(`httpStatusCode = ${resp.statusCode}`)));
            }
        });
        req.on('timeout', (err: any) => {
            req.abort();
            this.tryError(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.REQUEST_TIMEOUT, err));
        });
        req.on('error', (err) => {
            req.abort();
            this.tryError(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.SERVER_UNAVAILABLE, err));
        });
        req.on('close', () => {
            req.abort();
            // this.printLog('-> response closed');
        });
        req.end();
    }

    /**
     * 处理响应
     * @param resp
     */
    private handleResponse(resp: http.IncomingMessage) {
        this.resp = resp;
        const {chunkFilePath} = this;
        // 创建块文件输出流
        let stream: FileOperator.WriteStream;
        if (this.isResume()) {
            stream = FileOperator.openAppendStream(chunkFilePath);
        } else {
            stream = FileOperator.openWriteStream(chunkFilePath);
        }
        this.writeStream = stream;
        resp.on('data', (dataBytes: any) => {
            if (!this.canWriteFile() || !stream.writable) {
                this.abortRequest();
                return;
            }
            /**
             * ******************** 此处不可以使用 ********************
             * fs.appendFile(chunkFilePath, dataBytes, cb) 或者 fs.appendFileSync(chunkFilePath, chunk)
             * 前者高频调用fs.appendFile会抛出异常: EMFILE: too many open files
             * 后者在写入过程中会导致整个nodejs进程假死, 界面不可操作
             */
            stream.write(dataBytes, (err: any) => {
                if (err) {
                    stream.close();
                    this.tryError(
                        true,
                        ErrorMessage.fromErrorEnum(DownloadErrorEnum.WRITE_CHUNK_FILE_ERROR, err)
                    );
                } else {
                    // 正常
                    if (this.updateProgress(dataBytes.length) >= this.length) {
                        // 进度已经100%
                        this.printLog(`-> response end while status @${this.getStatus()}`);
                        // 因为其它而停止下载任务或者被暂停时, 不应该发送MERGE事件通知DownloadTask合并任务
                        if (this.getStatus() === DownloadStatus.DOWNLOADING) {
                            this.tryMerge(true);
                        }
                    }
                }
            });
        });
    }


    /**
     * 废弃当前请求
     */
    private abortRequest() {
        const {req, resp, writeStream} = this;
        if (writeStream) {
            writeStream.close();
            this.writeStream = undefined;
        }
        if (req) {
            req.abort();
            req.destroy();
        }
        this.req = undefined;
        if (resp) {
            resp.destroy();
        }
        this.resp = undefined;
    }

    public getProgress(ticktock: number) {
        const {index, length, prevProgress, progress, noResponseTime, options} = this;
        this.prevProgress = progress;
        if (this.getStatus() === DownloadStatus.DOWNLOADING) {
            if (prevProgress === progress) {
                this.noResponseTime += ticktock;
                if (this.noResponseTime >= options.httpTimeout) {
                    this.tryError(false, ErrorMessage.fromErrorEnum(DownloadErrorEnum.REQUEST_TIMEOUT, new Error()));
                }
            } else {
                this.noResponseTime = 0;
            }
        }
        return {
            index,
            length,
            progress,
            prevProgress,
            noResp: noResponseTime,
            retry: this.retryTimes,
        };
    }

    private updateProgress(newProgress: number) {
        this.progress += newProgress;
        return this.progress;
    }


    public isResume() {
        return this.length > 0;
    }

    public canMerge() {
        return this.getStatus() === DownloadStatus.MERGING;
    }

    /**
     * 根据状态判断是否可以写文件
     */
    protected canWriteFile() {
        return this.getStatus() === DownloadStatus.DOWNLOADING;
    }


    private printLog(...args: any[]) {
        Logger.debug(`[DownWorker-${this.simpleTaskId}-${this.index}]`, ...args);
    }
}