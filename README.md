# gre_prep

本地 GRE 学习台：综合题库、800 词卡和统一资料库。下载整个仓库，解压后用浏览器打开 **`GRE-start.html`** 即可；日常使用不需要启动脚本、Python、Node.js 或服务器。

## 学习与资料

- **阅间综合训练**：`gre-reading-studio/dist/index.html`，包含阅读、填空、数学、写作与模考。
- **词间 800 词卡**：`gre800-cards/dist/index.html`，包含自认复习、反向回忆、同义词与间隔复习。
- **全部资料**：`materials/index.html`，可搜索题目原书、词汇表与参考资料。原始文档统一放在 `materials/`，完全相同的副本只保留一份。

题库目前包含 **10,348 道题目，5,487 道可判分题**。本次已解压并核对资料压缩包，其中的题目此前均已收录；新增整理 4 份词汇资料，没有重复增加题目。来源与文件校验清单见 `materials/manifest.json`，压缩包核对记录见 `gre-reading-studio/reports/archive-refresh.json`。

## 保存进度

阅间默认自动保存到当前浏览器，底栏显示实际保存状态。点击「保存进度」可立即保存；不必选择文件夹。

如需额外备份，在 Chrome 或 Edge 中点击「选择备份文件夹」，选择电脑、OneDrive 等同步盘或移动存储上的可写文件夹。允许读写后会自动备份至 `progress.json`，并保留上一份快照。换电脑时选择同一文件夹即可恢复；同步盘的跨设备同步由同步软件完成。

底栏的「导出进度」「导入进度」适用于不支持文件夹授权的浏览器，备份包含导入的题库。词间的独立进度在「学习分析」中导出、导入。换浏览器、移动项目或清理浏览器数据前，请先备份；浏览器存储不会自动跨设备同步。

AI 功能需要网络和可用的 API 额度。在页面中输入自己的 OpenAI API Key；密钥仅保留在页面内存中，不写入进度文件。

## 项目维护

`scripts/` 中保留题库构建、资料提取和校核工具，供维护数据时使用；网页启动不调用这些脚本。`tests/` 与 `portability-tests/` 用于验证题库、页面和保存功能。

重新构建已整理的题库：

```sh
python gre-reading-studio/scripts/build_data.py
python gre-reading-studio/scripts/build_platform.py
python gre-reading-studio/scripts/build_material_catalog.py
```

构建统一题库需要 `openpyxl`；从原 PDF 重新提取还需 `pypdf`。保留 `materials/` 和 `data/`，不需要旧压缩包或临时工作目录。

个人进度、密钥、本机缓存和清理备份不纳入 Git。完整使用说明见 `使用说明.txt`。
