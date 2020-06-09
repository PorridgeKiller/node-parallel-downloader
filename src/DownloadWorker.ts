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
    Logger,
    Config,
    DownloadErrorEnum,
    DownloadEvent,
    DownloadStatus,
    ErrorMessage,
    CommonUtils,
    HttpRequestOptionsBuilder,
} from './Config';
import DownloadStatusHolder from './DownloadStatusHolder';

export interface WorkerOptions {
    httpRequestOptionsBuilder?: HttpRequestOptionsBuilder
}

export default class DownloadWorker extends DownloadStatusHolder {
    private downloadDir: string;
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
    private req: http.ClientRequest | undefined;


    constructor(taskId: string, downloadDir: string, length: number, contentType: string, index: number,
                from: number, to: number, progress: number, downloadUrl: string, options: WorkerOptions) {
        super();
        this.downloadDir = downloadDir;
        this.taskId = taskId;
        this.length = length;
        this.contentType = contentType;
        this.index = index;
        this.from = from;
        this.to = to;
        this.progress = progress;
        this.downloadUrl = downloadUrl;
        this.options = options;
        this.chunkFilePath = FileOperator.pathJoin(downloadDir, CommonUtils.getChunkFilename(taskId, index));
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
            // todo
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.DOWNLOADING
     * 块任务开始
     */
    public async tryStart(emit: boolean) {
        return await this.tryResume(emit);
    }

    /**
     * 状态设置为DownloadStatus.DOWNLOADING
     * 块任务恢复
     */
    public async tryResume(emit: boolean) {
        const flag = await this.compareAndSwapStatus(DownloadStatus.DOWNLOADING);
        if (flag) {
            this.doDownloadRequest();
            emit && this.emit(DownloadEvent.STARTED, this.index);
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
            if (FileOperator.existsAsync(this.chunkFilePath, false)) {
                await FileOperator.deleteFileOrDirAsync(this.chunkFilePath);
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
        const flag = await this.compareAndSwapStatus(DownloadStatus.ERROR);
        if (flag) {
            this.abortRequest();
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
        const flag = this.compareAndSwapStatus(DownloadStatus.MERGING);
        if (flag) {
            emit && this.emit(DownloadEvent.MERGE, this.index);
        }
        return flag;
    }


    public getProgress() {
        return this.progress;
    }

    public updateProgress(newProgress: number) {
        this.progress += newProgress;
    }

    public resetProgress(progress: number) {
        this.progress = progress;
    }


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
        this.req = req;
        // 不知道为何，实际时长是两倍，15000ms = 实际30s
        req.setTimeout(30000);
        req.on('response', async (resp: http.IncomingMessage) => {
            if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) {
                this.handleResponse(resp);
            } else {
                // @ts-ignore
                await this.tryError(true, ErrorMessage.fromCustomer(resp.statusCode, resp.statusMessage,
                    new Error(`httpStatusCode = ${resp.statusCode}`)));
            }
        });
        req.on('timeout', (err: any) => {
            this.tryError(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.REQUEST_TIMEOUT, err));
        });
        req.on('error', (err) => {
            this.tryError(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.SERVER_UNAVAILABLE, err));
        });
        req.on('close', () => {
            // this.printLog('-> response closed');
        });
        req.on('abort', () => {
            // this.printLog('-> response abort');
        });
        req.end();
    }

    /**
     * 废弃当前请求
     */
    private abortRequest() {
        const {req} = this;
        req && req.abort();
        this.req = undefined;
    }


    private handleResponse(resp: http.IncomingMessage) {
        const {chunkFilePath} = this;
        const responseHeaders = resp.headers;
        // 创建块文件输出流
        let stream: FileOperator.WriteStream;
        if (this.isResume()) {
            stream = FileOperator.openAppendStream(chunkFilePath);
        } else {
            stream = FileOperator.openWriteStream(chunkFilePath);
        }
        resp.on('data', (dataBytes: any) => {
            if (!this.canWriteFile()) {
                return;
            }
            /**
             * ******************** 此处不可以使用 ********************
             * fs.appendFile(chunkFilePath, dataBytes, cb) 或者 fs.appendFileSync(chunkFilePath, chunk)
             * 前者高频调用fs.appendFile会抛出异常: EMFILE: too many open files
             * 后者在写入过程中会导致整个nodejs进程假死, 界面不可操作
             */
            stream.write(dataBytes, (err: any) => {
                if (!err) {
                    // 正常
                    this.updateProgress(dataBytes.length);
                } else {
                    this.tryError(
                        true,
                        ErrorMessage.fromErrorEnum(DownloadErrorEnum.WRITE_CHUNK_FILE_ERROR, err)
                    );
                }
            });
        });
        resp.on('end', async () => {
            this.req = undefined;
            stream.close();
            this.printLog(`-> response end while status @${this.getStatus()}`);
            if (this.getStatus() === DownloadStatus.ERROR || this.getStatus() === DownloadStatus.STOPPED) {
                // 因为错误而停止下载任务或者被暂停时, 不应该发送MERGE事件通知DownloadTask合并任务
            } else {
                await this.tryMerge(true);
            }
        });
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