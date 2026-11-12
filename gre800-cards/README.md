# 词间 · GRE 800

直接打开 `dist/index.html`，或从根目录 `GRE-start.html` 进入。无需安装依赖或运行启动脚本。

包含原词书 001–800 的全部词条、815 个考法释义和 8 个 List。支持词卡、自认复习、特殊待复习列表、反向回忆、同义词训练、测试和间隔复习；保留原书页码与词义来源。

## 进度

学习记录自动保存到当前浏览器。在「学习分析」中导出或导入 JSON 备份；换浏览器、移动项目或清理浏览器数据前请先备份。词间的进度与阅间综合训练独立。

## 资料与维护

原始词汇 PDF 和词表统一放在根目录 `materials/`，可打开 `../materials/index.html` 查阅。`dist/words.js` 与 `dist/words.json` 是网页所用的词库；其余 `dist/` 文件是页面运行代码。

`scripts/extract_vocab.py` 通过统一资料清单找到原始 PDF，重新提取需要 `pypdf`。`scripts/audit-lexicon.cjs` 用于词库关系校核。它们仅供维护数据，日常学习不需要执行。

核心校验：`node --test gre800-cards/tests/*.test.cjs`（在项目根目录运行）。
