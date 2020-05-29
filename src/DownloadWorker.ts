/**
 * Description:
 * Author: SiFan Wei - weisifan
 * Date: 2020-05-18 17:35
 */
import * as url from 'url';
import * as http from 'http';
import * as https from 'https';
import * as FileOperator from './util/FileOperator';
import Logger from './util/Logger';
import {EventEmitter} from 'events';
import {
    DownloadStatusHolder,
    Config,
    DownloadErrorEnum,
    DownloadEvent,
    DownloadStatus,
    ErrorMessage
} from './Config';


export default class DownloadWorker extends DownloadStatusHolder {
    private downloadDir: string;
    private taskId: string;
    private index: number;
    private from: number = 0;
    private to: number = 0;
    private downloadUrl: string;
    private chunkFilePath: string;
    private contentLength: number;
    private contentType: string;

    private progressBytes: number = 0;
    private req?: http.ClientRequest;


    constructor(taskId: string, downloadDir: string, contentLength: number, contentType: string, index: number,
                from: number, to: number, downloadUrl: string) {
        super();
        this.downloadDir = downloadDir;
        this.taskId = taskId;
        this.contentLength = contentLength;
        this.contentType = contentType;
        this.index = index;
        this.from = from;
        this.to = to;
        this.downloadUrl = downloadUrl;
        this.chunkFilePath = FileOperator.pathJoin(downloadDir, DownloadWorker.getChunkFilename(index));
        this.init();
    }


    public static getChunkFilename(index: number) {
        return 'chunk_' + index + Config.BLOCK_FILENAME_EXTENSION;
    }

    /**
     * 设置初始化
     */
    private init() {
        const flag = this.compareAndSwapStatus(DownloadStatus.INIT);
        if (flag) {
            const {contentLength, from, to} = this;
            this.progressBytes = contentLength - (to - from + 1);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.DOWNLOADING
     * 块任务开始
     */
    public async start(emit: boolean) {
        return await this.resume(emit);
    }

    /**
     * 状态设置为DownloadStatus.DOWNLOADING
     * 块任务恢复
     */
    public async resume(emit: boolean) {
        const flag = await this.compareAndSwapStatus(DownloadStatus.DOWNLOADING);
        if (flag) {
            this.doDownloadRequest(this.downloadUrl);
            Logger.debug(`[DownloadWorker]Started: ${this.index}`);
            emit && this.emit(DownloadEvent.STARTED, this.index);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.STOP
     * 块任务暂停
     */
    public async stop(emit: boolean) {
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
    public async cancel(emit: boolean) {
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
    public async error(emit: boolean, error: ErrorMessage) {
        const flag = await this.compareAndSwapStatus(DownloadStatus.ERROR);
        if (flag) {
            this.abortRequest();
            emit && this.emit(DownloadEvent.ERROR, this.index, error);
        }
        return flag;
    }

    /**
     * 状态设置为DownloadStatus.FINISHED
     * 块任务完成
     */
    public async finish(emit: boolean) {
        const flag = this.compareAndSwapStatus(DownloadStatus.FINISHED);
        if (flag) {
            emit && this.emit(DownloadEvent.FINISHED, this.index);
        }
        return flag;
    }


    public getProgressBytes() {
        return this.progressBytes;
    }

    public updateProgressBytes(newChunkSize: number) {
        this.progressBytes += newChunkSize;
    }


    private doDownloadRequest(urlPath: string) {
        const {taskId, from, to, contentLength, contentType} = this;
        const parsedUrl = url.parse(urlPath);
        // 发送的数据序列化
        // const getData = querystring.stringify({
        //     taskId,
        // });
        // Logger.debug('getData: ' + getData);
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
                'Range': `bytes=${from}-${to}`
            },
        };
        Logger.debug('Range:' + `bytes=${from}-${to}`);
        // 创建request
        let request;
        if ('http:' === parsedUrl.protocol) {
            request = http.request(opts);
        } else if ('https:' === parsedUrl.protocol) {
            request = https.request(opts);
        } else {
            // 不支持的协议
            this.emit(DownloadEvent.ERROR, this.index, DownloadErrorEnum.UNKNOWN_PROTOCOL);
            return;
        }
        // 监听并发起request
        this.sendRequest(request);
    }

    public isFinished() {
        return this.getStatus() === DownloadStatus.FINISHED;
    }


    /**
     * 发送request请求，并监听一系列事件
     * @param req 请求
     */
    private sendRequest(req: http.ClientRequest) {
        this.emit(DownloadEvent.STARTED, this.index);
        this.req = req;
        // 不知道为何，实际时长是两倍，15000ms = 实际30s
        req.setTimeout(30000 / 2);
        req.on('connect', () => {
            Logger.info('-> request connect');
        });
        // @ts-ignore
        req.on('response', (resp: http.ClientResponse) => {
            this.handleResponse(resp);
        });
        req.on('timeout', () => {
            Logger.info('-> request timeout');
            this.error(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.REQUEST_TIMEOUT));
        });
        req.on('error', (err) => {
            Logger.info('-> request error', err);
            this.error(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.SERVER_UNAVAILABLE));
        });
        req.on('close', () => {
            Logger.info('-> request closed');
        });
        req.on('abort', () => {
            Logger.info('-> request abort');
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
                    // Logger.debug('this.getProgressBytes() =', this.getProgressBytes());
                    // if (this.getProgressBytes() > 1000000) {
                    //     err = new Error();
                    // }
                    if (!err) {
                        // 正常
                        this.updateProgressBytes(dataBytes.length);
                    } else {
                        this.error(true, ErrorMessage.fromErrorEnum(DownloadErrorEnum.WRITE_CHUNK_FILE_ERROR));
                    }
                });
            });
            resp.on('end', async () => {
                this.req = undefined;
                appendStream.close();
                // 因为错误而停止下载任务时, 不应该发送finish事件
                if (this.getStatus() !== DownloadStatus.ERROR) {
                    Logger.debug('-> response end');
                    await this.finish(true);
                } else {
                    Logger.debug('-> response end with error');
                }
            });
        } else {
            await this.error(true, ErrorMessage.fromCustomer(resp.statusCode, resp.statusMessage));
        }
    }

    /**
     * 根据状态判断是否可以写文件
     */
    protected canWriteFile() {
        return this.getStatus() === DownloadStatus.DOWNLOADING;
    }

}