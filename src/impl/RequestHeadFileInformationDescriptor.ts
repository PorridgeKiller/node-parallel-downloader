/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-06-07 00:20
 * 根据下载链接URL, 使用http-HEAD请求去获取文件的尺寸+类型
 */
import * as url from 'url';
import * as http from 'http';
import * as https from 'https';
import {
    FileDescriptor,
    FileInformationDescriptor,
    CommonUtils,
    Logger
} from '../Config';

const requestMethodHeadFileInformationDescriptor: FileInformationDescriptor = async (descriptor: FileDescriptor): Promise<FileDescriptor> => {
    const downloadUrl = descriptor.downloadUrl;
    const parsedUrl = url.parse(downloadUrl);
    const opts: http.RequestOptions = {
        method: 'HEAD',
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.path,
        agent: false,
        protocol: parsedUrl.protocol,
    };
    // 创建request
    let request: http.ClientRequest;
    if ('http:' === parsedUrl.protocol) {
        request = http.request(opts);
    } else if ('https:' === parsedUrl.protocol) {
        request = https.request(opts);
    } else {
        // 不支持的协议
        return Promise.reject(new Error('unsupported protocol: ' + parsedUrl.protocol));
    }
    return new Promise<FileDescriptor>((resolve, reject) => {
        // 监听并发起request
        request.setTimeout(30000);

        let requestError: Error;
        // @ts-ignore
        request.on('response', (response: http.IncomingMessage) => {
            if (response.statusCode && response.statusCode == 200) {
                const responseHeaders: http.IncomingHttpHeaders = response.headers;
                // @ts-ignore
                descriptor.contentLength = responseHeaders['content-length'];
                // @ts-ignore
                descriptor.contentType = responseHeaders['content-type'];
                const acceptRanges = responseHeaders['accept-ranges'];
                if (acceptRanges && acceptRanges === 'bytes' && !!descriptor.contentLength) {
                    descriptor.resume = true;
                } else {
                    descriptor.resume = false;
                }
                if (!descriptor.filename) {
                    descriptor.filename = getFilenameFromResponseHeader(responseHeaders) || getFilenameFromUrl(downloadUrl);
                }
                printLog(descriptor.taskId, `filename=${descriptor.filename}; contentLength=${descriptor.contentLength}; contentType=${descriptor.contentType}; resume=${descriptor.resume}`);
            } else {
                requestError = new Error(`response status error: statusCode = ${response.statusCode}; statusMessage = ${response.statusMessage}`);
            }
        });
        request.on('timeout', (err: any) => {
            if (!requestError) {
                requestError = err;
                request.abort();
            }
        });
        request.on('error', (err) => {
            if (!requestError) {
                requestError = err;
                request.abort();
            }
        });
        request.on('close', () => {
            if (requestError) {
                reject(requestError);
            } else {
                resolve(descriptor);
            }
        });
        request.end();
    });
};


function getFilenameFromResponseHeader(responseHeaders: http.IncomingHttpHeaders) {
    let contentDisposition = responseHeaders['content-disposition'];
    if (contentDisposition) {
        const start = 'attachment;';
        const index = contentDisposition.indexOf(start);
        if (index === 0) {
            contentDisposition = contentDisposition.substring(start.length);
        }
        while (true) {
            if (contentDisposition.startsWith(' ')) {
                contentDisposition = contentDisposition.substring(1);
            } else {
                break;
            }
        }
        const tag = 'filename=';
        const index2 = contentDisposition.indexOf(tag);
        if (index2 === 0) {
            contentDisposition = contentDisposition.substring(tag.length);
        }
    }
    return contentDisposition;
}


function getFilenameFromUrl(url: string) {
    const lastIndex = url.lastIndexOf('/');
    return url.substring(lastIndex + 1);
}

function printLog(taskId: string, ...args: any) {
    Logger.debug(`[MethodHead-Descriptor-${CommonUtils.getSimpleTaskId(taskId)}]:`, ...args);
}


export default requestMethodHeadFileInformationDescriptor;