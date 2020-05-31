## node-parallel-downloader
基于nodejs实现的多线程断点续传的多任务下载器

#### Features
- 全异步IO操作. 包括所有目录/文件读写操作, 高性能保证
- 多线程下载. 每个下载任务内部由多个http请求支持, 并行下载不同的文件块, 更充分压榨网络带宽资源
- 断点续传. 任务暂停或者进程结束后, 再次启动下载器可以接上之前的进度继续下载, 高容错性
- 文件完整性保证. 由于下载器对状态快速切换做了优化处理(基于CAS), 各种状态之间切换可立马生效, 下载状态一致性有高度保证
- 多任务并行. 可以支持多个任务同时下载

### 1. 安装

##### 1.1. npm

```
npm install --save parallel-downloader
```

### 2. API

##### 2.1. 主要的类有两个

- DownloadTask extends EventEmitter


继承了EventEmitter，管理一个下载任务, 一个文件的下载任务对应一个Task, 一个Task内部管理了多个Worker. 下载任务会被分解为多个文件块来下载, 最后合并为目标文件(相当于多线程下载)
- DownloadManager 

管理一个下载任务组, 内部管理多个DownloadTask, 用来创建任务

##### 2.2. 使用方式

###### 2.2.1. 导包

```typescript
import {
    DownloadManager, 
    DownloadTask, 
    DownloadEvent, 
    DownloadStatus, 
    FileDescriptor, 
    Logger, 
    FileInformationDescriptor, 
    ErrorMessage
} from "parallel-downloader";
```

###### 2.2.2. 创建任务组
```typescript
const manager = new DownloadManager()
    // 指定配置文件保存的位置
    .configConfigDir('./temp_info')
    // 指定每个下载任务最大的分割数量
    .configMaxWorkerCount(5)
    // 指定下载进度通知频率/ms
    .configProgressTicktockMillis(1000)
    // 指定下载任务taskId的生成方式, taskId要求: 针对同一个下载任务, taskId唯一
    .configTaskIdGenerator(async (downloadUrl: string, storageDir: string, filename: string) => {
        return md5(downloadUrl);
    })
    // 指定文件尺寸, 文件content-type的获取方式
    .configFileInfoDescriptor(async (descriptor: FileDescriptor) => {
        return descriptor;
    });
```
###### 2.2.3. 扫描没有下载完成的任务
````typescript
await manager.loadInfoFiles();
````

###### 2.2.4. 新建下载任务

```typescript
// 此处会返回DownloadTask对象
// 如果该任务下载了一半, 则返回的是下载了一半的DownloadTask对象
const task: DownloadTask = await manager.newTask(
		'https://your_download_url',
  	'download_directory',
  	'filename',
  	// 任务启用'线程'数
  	5 
);
```

###### 2.2.5. 注册任务监听器

```typescript
// 开始事件
task.on(DownloadEvent.STARTED, (descriptor) => {
  	Logger.debug('+++DownloadEvent.STARTED:');
  	Logger.debug('status0:', task.getStatus());
})
// 下载进度事件
.on(DownloadEvent.PROGRESS, (descriptor, progress) => {
    const percent = Math.round((progress.progress / progress.contentLength) * 10000) / 100;
    const speedMbs = Math.round(progress.speed / 1024 / 1024 * 100) / 100;
    const progressMbs = Math.round(progress.progress / 1024 / 1024 * 100) / 100;
		Logger.debug('+++DownloadEvent.PROGRESS:', `percent=${percent}%; speed=${speedMbs}MB/s; progressMbs=${progressMbs}MB`);
  	Logger.debug('status-progress:', task.getStatus());
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







