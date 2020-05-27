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
import {Config, DownloadErrorEnum, DownloadEvent, DownloadStatus, ErrorMessage} from './Config';


export default class DownloadWorker extends EventEmitter {
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
    private status: DownloadStatus = DownloadStatus.INIT;

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
    }


    public static getChunkFilename(index: number) {
        return 'chunk_' + index + Config.BLOCK_FILENAME_EXTENSION;
    }

    public async start() {
        return await this.resume();
    }

    /**
     * 暂停任务
     */
    public async stop() {
        return this.compareAndSwapStatus(DownloadStatus.STOP);
    }

    /**
     * 开始或继续任务
     */
    public async resume() {
        return this.compareAndSwapStatus(DownloadStatus.DOWNLOADING);
    }

    /**
     * 取消任务
     */
    public async cancel() {
        const flag = this.compareAndSwapStatus(DownloadStatus.CANCEL);
        if (flag) {
            if (FileOperator.existsAsync(this.chunkFilePath, false)) {
                await FileOperator.deleteFileOrDirAsync(this.chunkFilePath);
            }
        }
        return this.compareAndSwapStatus(DownloadStatus.CANCEL);
    }

    /**
     * 取消任务
     */
    public async error() {
        if (this.getStatus() === DownloadStatus.FINISHED) {
            return false;
        }
        return this.compareAndSwapStatus(DownloadStatus.ERROR);
    }


    private async finish() {
        const flag = this.compareAndSwapStatus(DownloadStatus.FINISHED);
        if (flag) {
            this.emit(DownloadEvent.FINISHED, this.index);
        }
        return flag;
    }

    /**
     * 更新状态
     * @param status
     */
    public compareAndSwapStatus(status: DownloadStatus): boolean {
        if (this.status === status) {
            // 返回false时候代表要更新的状态和之前的状态一样, 表明重复多余设置
            // false可以用来控制ERROR等回调只执行一次, 因为下载write操作很频繁, 不加控制会回调上百次
            return false;
        }
        this.status = status;
        Logger.debug(`[DownloadWorker]chunk_${this.index}: updateStatus:`, status);
        if (status === DownloadStatus.ERROR || status === DownloadStatus.CANCEL ||
            status === DownloadStatus.STOP) {
            const {req} = this;
            if (req !== undefined) {
                req.abort();
            }
        } else if (status === DownloadStatus.DOWNLOADING) {
            this.initCurrentProgress();
            this.request(this.downloadUrl);
            Logger.debug(`[DownloadWorker]Started: ${this.index}`);
        }
        return true;
    }


    // private updateStatusMap(status: DownloadStatus): boolean {
    //     const {status, statusMap} = this;
    //     const value = statusMap.get(status);
    //     if (value) {
    //
    //     }
    // }

    public getStatus() {
        return this.status;
    }

    public getContentLength() {
        return this.contentLength;
    }

    public getProgressBytes() {
        return this.progressBytes;
    }

    public updateProgressBytes(newChunkSize: number) {
        this.progressBytes += newChunkSize;
    }


    public request(urlPath: string) {
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
        return this.status === DownloadStatus.FINISHED;
    }

    private initCurrentProgress() {

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
        // @ts-ignore
        req.on('response', (resp: http.ClientResponse) => {
            this.handleResponse(resp);
        });
        req.on('timeout', () => {
            Logger.info('-> request timeout');
            this.error().then(() => {
                this.emit(DownloadEvent.ERROR, this.index, ErrorMessage.fromErrorEnum(DownloadErrorEnum.REQUEST_TIMEOUT));
            });
        });
        req.on('error', (err) => {
            Logger.info('-> request error', err);
            this.error().then(() => {
                this.emit(DownloadEvent.ERROR, this.index, ErrorMessage.fromErrorEnum(DownloadErrorEnum.SERVER_UNAVAILABLE));
            });
        });
        req.on('close', () => {
            Logger.info('-> request closed');
            this.emit(DownloadEvent.CANCELED, 'request closed');
        });
        req.on('abort', () => {
            Logger.info('-> request abort');
            // if (!hasAlert) {
            //     this.emit(DownloadEvent.CANCELED, 'request abort');
            // }
        });
        req.end();
    }


    // @ts-ignore
    private async handleResponse(resp: http.ClientResponse) {
        const {chunkFilePath} = this;
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
            // 创建块文件输出流
            const writeStream = FileOperator.openWriteStream(chunkFilePath);
            resp.on('data', (dataBytes: any) => {
                if (this.getStatus() === DownloadStatus.ERROR || this.getStatus() === DownloadStatus.STOP ||
                    this.getStatus() === DownloadStatus.CANCEL) {
                    return;
                }
                /**
                 * ******************** 此处不可以使用 ********************
                 * fs.appendFile(chunkFilePath, dataBytes, cb) 或者 fs.appendFileSync(chunkFilePath, chunk)
                 * 前者高频调用fs.appendFile会抛出异常: EMFILE: too many open files
                 * 后者在写入过程中会导致整个nodejs进程假死, 界面不可操作
                 */
                writeStream.write(dataBytes, (err: any) => {
                    // Logger.debug('this.getProgressBytes() =', this.getProgressBytes());
                    // if (this.getProgressBytes() > 1000000) {
                    //     err = new Error();
                    // }
                    if (!err) {
                        // 正常
                        this.updateProgressBytes(dataBytes.length);
                    } else {
                        this.error().then((flag) => {
                            if (!flag) {
                                return;
                            }
                            Logger.error(err);
                            this.emit(DownloadEvent.ERROR, this.index,
                                ErrorMessage.fromErrorEnum(DownloadErrorEnum.WRITE_CHUNK_FILE_ERROR));
                        });
                    }
                });
            });
            resp.on('end', () => {
                writeStream.close();
                // 因为错误而停止下载任务时, 不应该发送finish事件
                if (this.getStatus() !== DownloadStatus.ERROR) {
                    Logger.debug('-> response end');
                    this.finish();
                } else {
                    Logger.debug('-> response end with error');
                }
            });
        } else {
            await this.error();
            this.emit(DownloadEvent.ERROR, this.index, ErrorMessage.fromCustomer(resp.statusCode, resp.statusMessage));
        }
    }
}
