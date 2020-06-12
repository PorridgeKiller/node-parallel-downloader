import {
    ConsoleLogger,
    DownloadEvent,
    DownloadStatus,
    DownloadTask,
    DownloadTaskGroup,
    FileDescriptor,
    Logger,
    requestMethodHeadFileInformationDescriptor,
    CommonUtils,
} from './lib/Config';
import http from 'http';
import crypto from 'crypto';
import process from 'process';

/**
 * Description: 示例代码
 * Author: SiFan Wei - porridge
 * Date: 2020-05-31 22:39
 */

// 设置不禁用log
Logger.setDisabled(false);
// 设置Logger的代理类
Logger.setProxy(new ConsoleLogger());

/**
 * 正常下载流程
 */
async function example(): Promise<DownloadTask> {
    // Logger.printStackTrace();
    const taskGroup = await new DownloadTaskGroup()
        .configConfigDir('./temp_info')
        .configMaxWorkerCount(3)
        .configProgressTicktockMillis(300)
        .configTaskIdGenerator(async (downloadUrl: string, storageDir: string, filename?: string) => {
            return crypto.createHash('md5').update(downloadUrl).digest('hex');
        })
        .configFileInfoDescriptor(requestMethodHeadFileInformationDescriptor)
        .configHttpRequestOptionsBuilder((requestOptions: http.RequestOptions, taskId: string, index: number, from: number, to: number, progress: number) => {
            return requestOptions;
        })
        .configRetryTimes(10000)
        .configHttpTimeout(5000)
        .loadFromConfigDir();

    const task: DownloadTask = await taskGroup.newTask(
        'https://a24.gdl.netease.com/2002061611_04022020_SV_Netrvios_198512.zip',
        'temp_repo',
        undefined
    );

    task.on(DownloadEvent.INITIALIZED, (descriptor) => {
        Logger.debug('+++DownloadEvent.INITIALIZED:', task.getStatus(), '任务创建直到完成, 只会调用一次');
    }).on(DownloadEvent.STARTED, (descriptor) => {
        Logger.debug('+++DownloadEvent.STARTED:', task.getStatus());
    }).on(DownloadEvent.STOPPED, (descriptor) => {
        Logger.debug('+++DownloadEvent.STOPPED:', task.getStatus());
    }).on(DownloadEvent.PROGRESS, (descriptor, progress) => {
        const ticktock = progress.ticktock;
        const beautified = CommonUtils.beautifyProgress(progress, ticktock);
        const chunks: any[] = [];
        progress.chunks.forEach((chunkProgress: any) => {
            const beautifiedChunk = CommonUtils.beautifyProgress(chunkProgress, ticktock);
            beautifiedChunk.noResp = chunkProgress.noResponseTime;
            beautifiedChunk.retry = chunkProgress.retry;
            chunks.push(beautifiedChunk);
        });
        beautified.chunks = chunks;
        Logger.debug('+++DownloadEvent.PROGRESS:', JSON.stringify(beautified));
    }).on(DownloadEvent.MERGE, (descriptor) => {
        Logger.debug('+++DownloadEvent.MERGE:', descriptor, task.getStatus());
    }).on(DownloadEvent.FINISHED, (descriptor) => {
        Logger.debug('+++DownloadEvent.FINISHED:', descriptor, task.getStatus());
    }).on(DownloadEvent.ERROR, (descriptor, errorMessage) => {
        Logger.error('+++DownloadEvent.ERROR:', descriptor, errorMessage, task.getStatus());
    }).on(DownloadEvent.CANCELED, (descriptor) => {
        Logger.warn('+++DownloadEvent.CANCELED:', descriptor, task.getStatus());
    });
    const started = await task.start();
    Logger.assert(started);


    // const task2: DownloadTask = await taskGroup.newTask(
    //     'http://download.redis.io/releases/redis-5.0.8.tar.gz',
    //     'temp_repo',
    //     undefined
    // );
    // task2.on(DownloadEvent.STARTED, (descriptor) => {
    //     Logger.debug('+++DownloadEvent.STARTED:', task2.getStatus());
    // }).on(DownloadEvent.PROGRESS, (descriptor, progress) => {
    //     const percent = Math.round((progress.progress / progress.contentLength) * 10000) / 100;
    //     const speedMbs = Math.round(progress.speed / 1024 / 1024 * 100) / 100;
    //     const progressMbs = Math.round(progress.progress / 1024 / 1024 * 100) / 100;
    //     Logger.debug('+++DownloadEvent.PROGRESS:', `percent=${percent}%; speed=${speedMbs}MB/s; progressMbs=${progressMbs}MB`, task2.getStatus(), JSON.stringify(progress));
    // }).on(DownloadEvent.MERGE, (descriptor) => {
    //     Logger.debug('+++DownloadEvent.MERGE:', descriptor, task2.getStatus());
    // }).on(DownloadEvent.FINISHED, (descriptor) => {
    //     Logger.debug('+++DownloadEvent.FINISHED:', descriptor, task2.getStatus());
    // }).on(DownloadEvent.ERROR, (descriptor, errorMessage) => {
    //     Logger.error('+++DownloadEvent.ERROR:', descriptor, errorMessage, task2.getStatus());
    // }).on(DownloadEvent.CANCELED, (descriptor) => {
    //     Logger.warn('+++DownloadEvent.CANCELED:', descriptor, task2.getStatus());
    // });
    // const started2 = await task2.start();
    // Logger.assert(started2);

    const task2: DownloadTask = await taskGroup.newTask(
        'https://a24.gdl.netease.com/1903091457_08232019_BC_Netease_177824.zip',
        'temp_repo',
        undefined
    );

    task2.on(DownloadEvent.INITIALIZED, (descriptor) => {
        Logger.debug('+++DownloadEvent.INITIALIZED:', task2.getStatus(), '任务创建直到完成, 只会调用一次');
    }).on(DownloadEvent.STARTED, (descriptor) => {
        Logger.debug('+++DownloadEvent.STARTED:', task2.getStatus());
    }).on(DownloadEvent.STOPPED, (descriptor) => {
        Logger.debug('+++DownloadEvent.STOPPED:', task2.getStatus());
    }).on(DownloadEvent.PROGRESS, (descriptor, progress) => {
        const ticktock = progress.ticktock;
        const beautified = CommonUtils.beautifyProgress(progress, ticktock);
        const chunks: any[] = [];
        progress.chunks.forEach((chunkProgress: any) => {
            const beautifiedChunk = CommonUtils.beautifyProgress(chunkProgress, ticktock);
            beautifiedChunk.noResp = chunkProgress.noResponseTime;
            beautifiedChunk.retry = chunkProgress.retry;
            chunks.push(beautifiedChunk);
        });
        beautified.chunks = chunks;
        Logger.debug('+++DownloadEvent.PROGRESS:', JSON.stringify(beautified));
    }).on(DownloadEvent.MERGE, (descriptor) => {
        Logger.debug('+++DownloadEvent.MERGE:', descriptor, task2.getStatus());
    }).on(DownloadEvent.FINISHED, (descriptor) => {
        Logger.debug('+++DownloadEvent.FINISHED:', descriptor, task2.getStatus());
    }).on(DownloadEvent.ERROR, (descriptor, errorMessage) => {
        Logger.error('+++DownloadEvent.ERROR:', descriptor, errorMessage, task2.getStatus());
    }).on(DownloadEvent.CANCELED, (descriptor) => {
        Logger.warn('+++DownloadEvent.CANCELED:', descriptor, task2.getStatus());
    });
    const started2 = await task2.start();
    Logger.assert(started2);

    return task;
}

/**
 * 每0.2s暂停/开始直到把文件下载完毕
 */
async function strictTest() {
    const task: DownloadTask = await example();
    let count = 0;
    while (true) {
        if (task.getStatus() === DownloadStatus.FINISHED || task.getStatus() === DownloadStatus.CANCELED) {
            break;
        }
        await loopStopStart(task, count++);
    }
    Logger.debug('download task done!!!');
    Logger.assert(task.getStatus() === DownloadStatus.FINISHED);
}


async function loopStopStart(task: DownloadTask, count: number) {
    return new Promise(async (resolve, reject) => {
        setTimeout(async () => {
            if (count % 2 === 0) {
                task.stop();
                task.stop();
                task.stop();
            } else {
                task.start();
                task.start();
            }
            Logger.debug(`loopStopStart-${count}`, task.getStatus());
            resolve();
        }, 500);
    });
}



const processArgs = process.argv;

const MODE_EXAMPLE = '--example';
const MODE_STRICT_TEST = '--strict-test';

for (let i = 0; i < processArgs.length; i++) {
    if (processArgs[i] === MODE_EXAMPLE) {
        example();
        break;
    } else if (processArgs[i] === MODE_STRICT_TEST) {
        strictTest();
        break;
    }
}

