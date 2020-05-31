/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-24 21:22
 */

import DownloadManager from './src/DownloadManager';
import {DownloadEvent, DownloadStatus, FileDescriptor} from './src/Config';
import Logger from './src/util/Logger';
import DownloadTask from "./src/DownloadTask";
import crypto from 'crypto';

async function test() {

    const manager = new DownloadManager()
        .configConfigDir('./temp_info')
        .configMaxWorkerCount(5)
        .configProgressTicktockMillis(1000)
        // .configTaskIdGenerator(async (downloadUrl: string, storageDir: string, filename: string) => {
        //     return md5(downloadUrl);
        // }).configFileInfoDescriptor(async (descriptor: FileDescriptor) => {
        //     return descriptor;
        // })
    ;
    manager.configFileInfoDescriptor(async (descriptor: FileDescriptor) => {
        descriptor.contentType = 'application/zip';
        descriptor.contentLength = (35623715);
        const md5 = crypto.createHash('md5');
        descriptor.md5 = md5.update(descriptor.downloadUrl).digest('hex');
        return descriptor;
    });
    await manager.loadInfoFiles();


    const task = await manager.newTask(
        'https://a24.gdl.netease.com/1926111511_electronuts.zip',
        'temp_repo',
        '1926111511.zip',
        5
    );
    task.on(DownloadEvent.STARTED, (descriptor) => {
        Logger.debug('+++DownloadEvent.STARTED:');
        Logger.debug('status0:', task.getStatus());
    }).on(DownloadEvent.PROGRESS, (descriptor, progress) => {
        const percent = Math.round((progress.progress / progress.contentLength) * 10000) / 100;
        const speedMbs = Math.round(progress.speed / 1024 / 1024 * 100) / 100;
        const progressMbs = Math.round(progress.progress / 1024 / 1024 * 100) / 100;
        Logger.debug('+++DownloadEvent.PROGRESS:', `percent=${percent}%; speed=${speedMbs}MB/s; progressMbs=${progressMbs}MB`);
        Logger.debug('status-progress:', task.getStatus());
    }).on(DownloadEvent.FINISHED, (descriptor) => {
        Logger.debug('+++DownloadEvent.FINISHED:', descriptor);
        Logger.debug('status3:', task.getStatus());
    }).on(DownloadEvent.ERROR, (descriptor, errorMessage) => {
        Logger.error('+++DownloadEvent.ERROR:', descriptor, errorMessage);
        Logger.error('status4:', task.getStatus());
    });
    manager.start(task.getTaskId());
    task.start();



    let count = 0;
    let flag = true;
    while (flag) {
        if (task.getStatus() === DownloadStatus.FINISHED) {
            break;
        }
        await loop(task, count++);
    }
    Logger.debug('任务结束');
}


async function loop(task: DownloadTask, count: number) {
    return new Promise(async (resolve, reject) => {
        setTimeout(async () => {
            if (count % 2 === 0) {
                await task.stop();
            } else {
                await task.start();
            }
            Logger.debug(`loop-${count}`, task.getStatus());
            resolve();
        }, 2000);
    });
}

test();