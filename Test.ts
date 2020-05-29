/**
 * Description:
 * Author: SiFan Wei - porridge
 * Date: 2020-05-24 21:22
 */

import DownloadManager from './src/DownloadManager';
import {DownloadEvent, FileDescriptor} from './src/Config';
import Logger from './src/util/Logger';
import * as crypto from 'crypto';

async function test() {

    // const writeStream = fs.createWriteStream('temp', {
    //     flags: 'a'
    // });
    //
    // for (let i = 0; i < 10; i++) {
    //     writeStream.write('text' + i + '\n');
    // }
    // writeStream.close();

    const manager = new DownloadManager()
        .configConfigDir('temp_info')
        .configMaxWorkerCount(5)
        .configProgressTicktockMillis(500);
    // manager.configFileInfoDescriptor(async (descriptor: FileDescriptor) => {
    //     descriptor.contentType = 'application/zip';
    //     descriptor.contentLength = (35623715);
    //     const md5 = crypto.createHash('md5');
    //     descriptor.md5 = md5.update(descriptor.downloadUrl).digest('hex');
    //     return descriptor;
    // });
    await manager.loadInfoFiles();
    const task = await manager.newTask(
        'https://a24.gdl.netease.com/2003011457_12162019_GG_NetVios_190535.zip',
        'temp_repo',
        'GG_NetVios.zip',
        10
    );

    // const task = await manager.newTask(
    //     'https://a24.gdl.netease.com/1926111511_electronuts.zip',
    //     'temp_repo',
    //     '1926111511.zip',
    //     5
    // );
    task.on(DownloadEvent.STARTED, () => {
        Logger.debug('+++DownloadEvent.STARTED:');
        Logger.debug('status0:', task.getStatus());
    }).on(DownloadEvent.PROGRESS, (progress) => {
        const percent = Math.round((progress.progress / progress.contentLength) * 10000) / 100;
        const speedMbs = Math.round(progress.speed / 1024 / 1024 * 100) / 100;
        const progressMbs = Math.round(progress.progress / 1024 / 1024 * 100) / 100;

        Logger.debug('+++DownloadEvent.PROGRESS:', `percent=${percent}%; speed=${speedMbs}MB/s; progressMbs=${progressMbs}MB`);
        Logger.debug('status-progress:', task.getStatus());
    }).on(DownloadEvent.FINISHED, (descriptor) => {
        Logger.debug('+++DownloadEvent.FINISHED:', descriptor);
        Logger.debug('status3:', task.getStatus());
    }).on(DownloadEvent.ERROR, (errorMessage) => {
        Logger.debug('+++DownloadEvent.ERROR:', errorMessage);
        Logger.debug('status4:', task.getStatus());
    });
    manager.start(task.getTaskId());
    setTimeout(async () => {
        for (let i = 0; i < 50; i++) {
            await task.stop();
            Logger.debug('status1:', task.getStatus());
            task.start();
            Logger.debug('status2:', task.getStatus());
        }
        // setTimeout(() => {
        //     task.cancel();
        //     Logger.debug('status-cancel:', task.getStatus());
        // }, 1000);
    }, 20000);
}

test();