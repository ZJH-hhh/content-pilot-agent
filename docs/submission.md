# 提交记录

- 项目：Content Pilot · **2. 内容任务规划 Agent**
- 交付方式：用户已授权创建 GitHub 仓库并上传，同时保留压缩包
- 文件：`Content-Pilot-Submission.zip`
- GitHub URL：[ZJH-hhh/content-pilot-agent](https://github.com/ZJH-hhh/content-pilot-agent)，私有仓库已创建
- 上传状态：完整项目已成功推送至 `main`；代码、文档、40 项测试报告、离线与真实模型 Trace 均在同一仓库
- 最终 commit SHA：以最终回复及压缩包旁 `submission-final.json` 回执核对的远程 `refs/heads/main` 完整 SHA 为准；克隆后执行 `git rev-parse HEAD` 可读取同一值
- 题号：**2**
- 访问权限：私有仓库，已通过所有者登录及推送验证；本人尚无指定评审账号，因此评审可读尚未确认
- 离线评审：解压后 `npm run dev`、`npm test`、`npm run examples`
- 实测 Node：24.15.0，最低要求 22.9+
- 真实模型验证：已实际执行，最终三场景及独立复核通过；请求模型 `gpt-6.1-sol`，见 `examples/live/README.md` 与原始记录
- 个人贡献披露：本人负责审计并提供修改反馈；工程实现、修订和运行验证由 Codex 执行。实际投入 2 天；具体分工见 `04-ai-usage.md`

## 压缩包内容

包含 README、依赖文件、`.env.example`、src、public、tests、data、examples、docs、scripts。examples 包含 12 组实际离线输入/输出/Trace、汇总、最新测试报告、浏览器验证说明与截图。真实接口运行完成后，独立记录位于 `examples/live/runs/`。

`docs/submission.json` 记录正式题号及仓库创建上传进展；URL、SHA 和评审访问必须以实际结果填入。`docs/contribution.json` 已记录本人承担审计、Codex 承担工程实现与运行验证的分工，以及本人报告的两天投入。运行 `npm run submission:check` 会生成 `examples/submission-status.json`；缺少远程或访问字段时仍返回非零退出码，不能用离线测试通过替代正式交付检查。

`commitShaSource=git-head` 表示检查命令从此仓库实际 `HEAD` 读取完整 SHA，避免在提交内部写入“该提交自身 SHA”导致无法自洽的循环。GitHub 上传完成后，最终回复与压缩包旁的交付回执记录实际远程 SHA。包内 `examples/submission-status.json` 是生成时的状态快照；仓库克隆后可重新运行检查命令获得当前 SHA。

不包含实际 `.env`、`.runtime/`、`.git/`、`node_modules/`、原始试题页面副本或手机号。初次打开网页没有历史任务是正常现象；在网页点击开始或运行示例生成器即可得到新的实际结果。

## 复现打包

在项目目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
```

脚本通过显式文件清单打包，防止旧包递归进入新包。压缩包不是生产部署包，服务默认只监听本机 127.0.0.1。
