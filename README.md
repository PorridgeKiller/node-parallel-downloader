## node-parallel-downloader
- 基于nodejs实现的多线程断点续传的多任务下载器，断点续传基于Http-Header中Range字段，格式[Range=bytes=0-789]
- 也可以下载不支持断点续传的链接

##### Gtihub

https://github.com/PorridgeKiller/node-parallel-downloader

#### Features
- 全异步IO操作. 包括所有目录/文件读写操作, 高性能保证
- 多线程下载. 每个下载任务内部由多个http请求支持, 并行下载不同的文件块, 更充分压榨网络带宽资源
- 断点续传. 任务暂停或者进程结束后, 再次启动下载器可以接上之前的进度继续下载, 高容错性
- 文件完整性保证. 由于下载器对状态快速切换做了优化处理(基于CAS), 各种状态之间切换可立马生效, 下载状态一致性有高度保证
- 多任务并行. 可以支持多个任务同时下载

### 1. 安装

##### 1.1. npm
https://www.npmjs.com/package/node-parallel-downloader
```
npm install --save node-parallel-downloader
```
##### 测试
```typescript
# 正常下载测试
npm run example
# 高速暂停/继续状态切换(每200ms切换, 无间歇切换也没问题, 只是可能没时间下载文件)下载测试, 直到文件下载完毕
npm run stricttest
```

### 2. API

##### 2.1. 主要的类有两个

- DownloadTask extends EventEmitter


继承了EventEmitter，管理一个下载任务, 一个文件的下载任务对应一个Task, 一个Task内部管理了多个Worker. 下载任务会被分解为多个文件块来下载, 最后合并为目标文件（相当于多线程下载，但实际上只有一个线程，却得到不低于多线程的效果，得益于nodejs的异步事件驱动机制）
- DownloadTaskGroup 

管理一个下载任务组, 内部管理多个DownloadTask，用来创建任务

##### 2.2. 使用方式

###### 2.2.1. 导包

```typescript
import {
    Logger, 
    ConsoleLogger, 
    LoggerInterface,
    DownloadTaskGroup, 
    DownloadTask, 
    DownloadEvent, 
    DownloadStatus, 
    FileDescriptor, 
    FileInformationDescriptor, 
    ErrorMessage,
  	requestMethodHeadFileInformationDescriptor
} from "node-parallel-downloader";
```

###### 2.2.2. 创建任务组
```typescript
const taskGroup = new DownloadTaskGroup()
    // 指定配置文件保存的位置
    .configConfigDir('./temp_info')
    // 指定每个下载任务最大的分割数量
    .configMaxWorkerCount(5)
    // 指定下载进度通知频率/ms
    .configProgressTicktockMillis(1000)
    // 指定下载任务taskId的生成方式, taskId要求: 针对同一个下载任务, taskId唯一
    .configTaskIdGenerator(async (downloadUrl: string, storageDir: string, filename?: string) => {
        return md5(downloadUrl);
    })
    // 指定文件尺寸, 文件content-type的获取方式
		.configFileInfoDescriptor(requestMethodHeadFileInformationDescriptor)
		// 指定http请求的options
		.configHttpRequestOptionsBuilder((requestOptions: http.RequestOptions, taskId: string, index: number, from: number, to: number, progress: number) => {
      	return requestOptions;
    })
;
```
###### 2.2.3. 扫描没有下载完成的任务
````typescript
await taskGroup.loadFromConfigDir();
````

###### 2.2.4. 新建下载任务

```typescript
// 此处会返回DownloadTask对象
// 如果该任务下载了一半, 则返回的是下载了一半的DownloadTask对象
const task: DownloadTask = await taskGroup.newTask(
    'https://your_download_url',
    'download_directory',
    'filename'
);
```

###### 2.2.5. 注册任务监听器

```typescript
// 初始化完成事件. 任务创建直到完成, 只会调用一次
task.on(DownloadEvent.INITIALIZED, (descriptor) => {
    Logger.debug('+++DownloadEvent.INITIALIZED:', task.getStatus(), '任务创建直到完成, 只会调用一次');
})
// 开始事件
.on(DownloadEvent.STARTED, (descriptor) => {
    Logger.debug('+++DownloadEvent.STARTED:');
    Logger.debug('status0:', task.getStatus());
})
// 暂停事件
.on(DownloadEvent.STOPPED, (descriptor) => {
    Logger.debug('+++DownloadEvent.STOPPED:', task.getStatus());
})
// 下载进度事件
.on(DownloadEvent.PROGRESS, (descriptor, progress) => {
    const percent = Math.round((progress.progress / progress.contentLength) * 10000) / 100;
    const speedMbs = Math.round(progress.speed / 1024 / 1024 * 100) / 100;
    const progressMbs = Math.round(progress.progress / 1024 / 1024 * 100) / 100;
    Logger.debug('+++DownloadEvent.PROGRESS:', `percent=${percent}%; speed=${speedMbs}MB/s; progressMbs=${progressMbs}MB`);
    Logger.debug('status-progress:', task.getStatus());
})
// 将要合并事件
.on(DownloadEvent.MERGE, (descriptor) => {
    Logger.debug('+++DownloadEvent.MERGE:', descriptor, task.getStatus());
})
// 下载完成事件
.on(DownloadEvent.FINISHED, (descriptor) => {
    Logger.debug('+++DownloadEvent.FINISHED:', descriptor);
    Logger.debug('status3:', task.getStatus());
})
// 下载错误事件
.on(DownloadEvent.ERROR, (descriptor, errorMessage) => {
    Logger.error('+++DownloadEvent.ERROR:', descriptor, errorMessage);
    Logger.error('status4:', task.getStatus());
})
// 任务取消事件
.on(DownloadEvent.CANCELED, (descriptor) => {
    Logger.warn('+++DownloadEvent.CANCELED:', descriptor, task.getStatus());
});
```

###### 2.2.6. 启动/继续/暂停/废弃下载任务

```typescript
// 开始任务&继续下载
async task.start();
// 暂停任务
async task.stop();
// 取消任务
async task.cancel();
```

###### 2.2.7. 获取任务信息

```typescript
// 获取当前任务状态
task.getStatus();
// 获取任务taskId
task.getTaskId();
// 获取任务信息, 不要尝试修改返回对象内数据
task.getDescriptor();
```

###### 2.2.8. 禁用或改变日志打印方式
```typescript
// 设置禁用log
Logger.setDisabled(true);
// 设置Logger的代理类
// Logger.setProxy()接受一个实现了LoggerInterface接口的对象参数
Logger.setProxy(new ConsoleLogger());
```


### 3. 示例代码
##### 3.1. 正常下载
```typescript
import {
    ConsoleLogger,
    DownloadEvent,
    DownloadStatus,
    DownloadTask,
    DownloadTaskGroup,
    FileDescriptor,
    Logger,
    requestMethodHeadFileInformationDescriptor,
} from './lib/Config';
import http from 'http';
import crypto from 'crypto';

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
        .configMaxWorkerCount(5)
        .configProgressTicktockMillis(500)
        .configTaskIdGenerator(async (downloadUrl: string, storageDir: string, filename?: string) => {
            return crypto.createHash('md5').update(downloadUrl).digest('hex');
        })
        .configFileInfoDescriptor(requestMethodHeadFileInformationDescriptor)
        .configHttpRequestOptionsBuilder((requestOptions: http.RequestOptions, taskId: string, index: number, from: number, to: number, progress: number) => {
            return requestOptions;
        })
        .loadFromConfigDir();

    const task: DownloadTask = await taskGroup.newTask(
        'https://a24.gdl.netease.com/Terminal.7z',
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
        const percent = Math.round((progress.progress / progress.contentLength) * 10000) / 100;
        const speedMbs = Math.round(progress.speed / 1024 / 1024 * 100) / 100;
        const progressMbs = Math.round(progress.progress / 1024 / 1024 * 100) / 100;
        Logger.debug('+++DownloadEvent.PROGRESS:', `percent=${percent}%; speed=${speedMbs}MB/s; progressMbs=${progressMbs}MB`, task.getStatus(), JSON.stringify(progress));
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
    return task;
}

example();
```

### X. 后续待优化
- [x] 1. Http的续传依据抽象化, 可用户自定义
- [x] 2. 提供内置基于HEAD请求获取文件尺寸的FileInformationDescriptor实现类
- [ ] 3. 提供更多回调事件
- [ ] 4. 尽量多的操作都交给DownloadTaskGroup管理完成, 增强其功能
- [ ] 5. 看情况增加文件完整性校验功能
- [x] 6. 第0个文件块不走拼接逻辑, 减少文件复制IO, 提高性能
