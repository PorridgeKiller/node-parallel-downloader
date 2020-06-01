/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:35
 */
import * as url from 'url';
import * as http from 'http';
import * as https from 'https';
import * as FileOperator from './util/FileOperator';
import {EventEmitter} from 'events';
import {Logger, Config, DownloadErrorEnum, DownloadEvent, DownloadStatus, ErrorMessage} from './Config';
import DownloadStatusHolder from './DownloadStatusHolder';


export default class DownloadWorker extends DownloadStatusHolder {
    private downloadDir: string;
    private taskId: string;
    private simpleTaskId: string;
    private index: number;
    private from: number = 0;
    private to: number = 0;
    private downloadUrl: string;
    private chunkFilePath: string;
    private contentLength: number;
    private contentType: string;

    private progress: number = 0;
    private req?: http.ClientRequest;


    constructor(taskId: string, downloadDir: string, contentLength: number, contentType: string, index: number,
                from: number, to: number, progress: number, downloadUrl: string) {
        super();
        this.downloadDir = downloadDir;
        this.taskId = taskId;
        this.simpleTaskId = this.getSimpleTaskId();
        this.contentLength = contentLength;
        this.contentType = contentType;
        this.index = index;
        this.from = from;
        this.to = to;
        this.progress = progress;
        this.downloadUrl = downloadUrl;
        this.chunkFilePath = FileOperator.pathJoin(downloadDir, DownloadWorker.getChunkFilename(index));
        this.tryInit();
    }


    public static getChunkFilename(index: number) {
        return 'chunk_' + index + Config.BLOCK_FILENAME_EXTENSION;
    }



    public getSimpleTaskId() {
        return this.taskId.substring(28);
    }

    /**
     * 设置初始化
     */
    private tryInit() {
        const flag = this.compareAndSwapStatus(DownloadStatus.INIT);
        if (flag) {
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
            this.doDownloadRequest(this.downloadUrl);
            emit && this.emit(DownloadEvent.STARTED, this.index);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.STOP
     * 块任务暂停
     */
    public async tryStop(emit: boolean) {
        const flag = this.compareAndSwapStatus(DownloadStatus.STOP);
        if (flag) {
            this.abortRequest();
            emit && this.emit(DownloadEvent.STOP, this.index);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.CANCEL
     * 块任务取消
     */
    public async tryCancel(emit: boolean) {
        const flag = this.compareAndSwapStatus(DownloadStatus.CANCEL);
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
        const flag = this.compareAndSwapStatus(DownloadStatus.MERGE);
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


    private doDownloadRequest(urlPath: string) {
        const {taskId, from, to, progress, contentLength, contentType} = this;
        const parsedUrl = url.parse(urlPath);
        const opts: http.RequestOptions = {
            method: 'GET',
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            agent: false,
            protocol: parsedUrl.protocol,
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Accept': contentType,
                'Connection': 'keep-alive',
                'Range': `bytes=${from + progress}-${to}`
            },
        };
        this.printLog(`Started: Range: bytes=${from + progress}-${to}; progress=${this.progress}`);
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
        // @ts-ignore
        req.on('response', (resp: http.ClientResponse) => {
            this.handleResponse(resp);
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


    // @ts-ignore
    private async handleResponse(resp: http.ClientResponse) {
        const {chunkFilePath} = this;
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
            // 创建块文件输出流
            const appendStream = FileOperator.openAppendStream(chunkFilePath);
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
                appendStream.write(dataBytes, (err: any) => {
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
                appendStream.close();
                this.printLog(`-> response end while status @${this.getStatus()}`);
                if (this.getStatus() === DownloadStatus.ERROR || this.getStatus() === DownloadStatus.STOP) {
                    // 因为错误而停止下载任务或者被暂停时, 不应该发送MERGE事件通知DownloadTask合并任务
                } else {
                    await this.tryMerge(true);
                }
            });
        } else {
            await this.tryError(true, ErrorMessage.fromCustomer(resp.statusCode, resp.statusMessage,
                new Error(`httpStatusCode = ${resp.statusCode}`)));
        }
    }

    public canMerge() {
        return this.getStatus() === DownloadStatus.MERGE;
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