# Zitao Chen · 学术主页

依据提供的简历整理的英文静态学术主页，采用雾蓝背景、靛紫色几何主视觉、杏橙色点缀和衬线标题，适用于 GitHub Pages。桌面展示双栏个人介绍、双栏项目卡片和时间线，手机自动切换为单栏。无需 Node.js、npm、Jekyll 或构建步骤，浏览器直接打开 `index.html` 即可预览。主页无需 JavaScript 即可阅读；独立模型演示页面使用 JavaScript 连接推理服务。

GitHub 用户名：**MuZhao2333**。目标仓库：**MuZhao2333.github.io**。发布成功后的主页地址：**https://muzhao2333.github.io/**。

## 文件

- `index.html`：个人介绍、研究方向、近期亮点、代表项目、论文、研究经历、教育荣誉、社区服务和联系方式。
- `styles.css`：配色、字体、布局和手机适配。
- `layout.css`：完整展示版的导航、首页、项目卡片、时间线及响应式样式。
- `visual.css`：雾蓝与靛紫色视觉主题、衬线字体层级、分区配色及手机布局。
- `assets/Zitao_Chen_CV.pdf`：你提供的原始简历副本，主页的 CV 链接会打开此文件。
- `assets/favicon.svg`：浏览器标签页图标。
- `assets/geometry-study.svg`、`assets/research-map.svg`、`assets/project-*.svg`：为主页绘制的几何主视觉与研究概念示意图，不是论文中的实验图或模型输出。主视觉直接使用 SVG 绘制，不依赖外部图片服务。
- `.nojekyll`：让 GitHub Pages 直接发布静态文件。

## 项目演示

模型演示的 HTTP 接口、请求队列、模型路由和部署脚本位于本仓库的 [backend/](backend/README.md)。模型代码与 checkpoint 独立放在服务器的 `MolAlign3D` 仓库中，由后端导入其 Python 包。GitHub Pages 发布静态页面，推理服务在服务器运行，公网入口配置在 `models/config.js`。

主页的 **Research in focus** 提供 MolAlign3D 和 SEAL-BG 两个代表项目的研究问题、方法介绍、个人贡献和相关链接。点击 **My contribution & research context** 可展开细节；论文列表也增加了内容摘要。

MolAlign3D 与 MolFLAE 的论文和项目入口指向 Molecular Lab：`https://muzhao2333.github.io/models/`。其下 encode-decode、wander、atom-edit、interpolation、swap 各有独立子页面，调用服务器上的真实模型。MolAlign3D 固定为 split-UniMol epoch 14，结构 latent 为 8 × 16；MolFLAE 为 10 × 32。

## 发布到 GitHub Pages

1. 登录你的 **MuZhao2333** 账号，打开 https://github.com/new?name=MuZhao2333.github.io ，创建一个 **Public** 仓库，名称为 **MuZhao2333.github.io**，并勾选 **Add a README file** 初始化仓库。如果这个仓库已经存在，先保留其中现有内容，再合并本主页文件。
2. 在仓库选择 **Add file → Upload files**，上传本文件夹内的文件和 `assets` 文件夹。确保 `index.html` 在仓库根目录，不能再套一层 `academic-homepage` 文件夹。浏览器上传时隐藏文件可能不会被选中；本网站不依赖 Jekyll 特性，遗漏 `.nojekyll` 也可正常显示。
3. 提交后打开 **Settings → Pages**。
4. 在 **Build and deployment** 中，Source 选择 **Deploy from a branch**，Branch 选择 **main**，目录选择 **/ (root)**，点击 **Save**。
5. 等待 Pages 部署成功，访问 **https://muzhao2333.github.io/**。部署结果可在仓库 **Actions** 或 **Settings → Pages** 查看。

也可使用普通项目仓库，地址会是 `https://muzhao2333.github.io/仓库名/`。资源全部使用相对路径，支持这两种部署方式；改用项目仓库时，请同步修改 `index.html` 中的 canonical 和 og:url，以及 `robots.txt`、`sitemap.xml` 中的网址。

## 日常更新

在 GitHub 上编辑 `index.html` 并提交后，Pages 会自动更新：

- **论文**：搜索 `class="publication"`，每个 `<li>` 是一篇论文。复制或删除整段即可增删论文，列表序号会自动更新。
- **论文状态**：把 `Under review` 改成最终会议和年份；添加真实论文、代码或项目链接。
- **日期**：更新最下方 `Last updated: October 2026`。
- **简历**：替换 `assets/Zitao_Chen_CV.pdf`，保持文件名一致即可。
- **头像**：现版不放头像。如果需要，上传照片到 `assets` 后在 `<header>` 中加入图片即可。
- **GitHub / Google Scholar / ORCID**：现版已添加你提供的 GitHub 账号 MuZhao2333。取得 Google Scholar 或 ORCID 的准确网址后，可以在 `contact-links` 中按现有格式添加普通链接。

## 内容说明

论文标题、作者顺序、会议与审稿状态、个人贡献和经历来自所提供的简历。MolAlign3D 的方法介绍与 MLS-Bench 的 140 个任务、12 个领域等细节也参考了论文公开摘要：

- MolAlign3D：https://icml.cc/virtual/2026/poster/66574
- MLS-Bench：https://arxiv.org/abs/2605.08678

三篇已有论文链接沿用简历中的原始链接；两篇审稿中论文没有虚构外链。近期亮点按年份整理，不虚构录用日期。请在论文状态变化后及时更新。

主页正文展示学术邮箱。**下载的 CV 是原始简历副本，其中包含手机号**；若希望公开版不含手机号，发布前替换此 PDF 即可。

页面不加载第三方字体、分析脚本或外部图片，也无需 API 密钥或服务端。
