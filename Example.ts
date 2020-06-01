import {
    Logger,
    ConsoleLogger,
    LoggerInterface,
    DownloadTaskGroup,
    DownloadTask,
    DownloadEvent,
    DownloadStatus,
    FileDescriptor} from './src/Config';
import crypto from 'crypto';
import process from 'process';

/**
 * Description:
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
    const taskGroup = await new DownloadTaskGroup()
        .configConfigDir('./temp_info')
        .configMaxWorkerCount(10)
        .configProgressTicktockMillis(500)
        .configTaskIdGenerator(async (downloadUrl: string, storageDir: string, filename: string) => {
            return crypto.createHash('md5').update(downloadUrl).digest('hex');
        })
        .configFileInfoDescriptor(async (descriptor: FileDescriptor) => {
            descriptor.contentType = 'application/x-7z-compressed';
            descriptor.contentLength = 39142884;
            // 自己实现md5, 暂时未使用
            descriptor.md5 = '';
            return descriptor;
        })
        .loadFromConfigDir();

    const task: DownloadTask = await taskGroup.newTask(
        'https://a24.gdl.netease.com/Terminal.7z',
        'temp_repo',
        'Terminal.7z',
        5
    );
    task.on(DownloadEvent.STARTED, (descriptor) => {
        Logger.debug('+++DownloadEvent.STARTED:', task.getStatus());
    }).on(DownloadEvent.PROGRESS, (descriptor, progress) => {
        const percent = Math.round((progress.progress / progress.contentLength) * 10000) / 100;
        const speedMbs = Math.round(progress.speed / 1024 / 1024 * 100) / 100;
        const progressMbs = Math.round(progress.progress / 1024 / 1024 * 100) / 100;
        Logger.debug('+++DownloadEvent.PROGRESS:', `percent=${percent}%; speed=${speedMbs}MB/s; progressMbs=${progressMbs}MB`, task.getStatus());
    }).on(DownloadEvent.FINISHED, (descriptor) => {
        Logger.debug('+++DownloadEvent.FINISHED:', descriptor, task.getStatus());
    }).on(DownloadEvent.ERROR, (descriptor, errorMessage) => {
        Logger.error('+++DownloadEvent.ERROR:', descriptor, errorMessage, task.getStatus());
    });
    const started = await task.start();
    return task;
}

/**
 * 每0.5s暂停/开始直到把文件下载完毕
 */
async function strictTest() {
    const task: DownloadTask = await example();
    let count = 0;
    while (true) {
        if (task.getStatus() === DownloadStatus.FINISHED) {
            break;
        }
        await loopStopStart(task, count++);
    }
    Logger.debug('download task done!!!');
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
        }, 100);
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

