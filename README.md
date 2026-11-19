# 一日三量

手机端饮食记录工具。设置碳水、蛋白质和脂肪的每日目标，查看当天的已摄入、剩余或超出量。支持输入实际摄入量、按每 100 克换算、临时计算、常用食物和按日期回看。每日目标持续沿用，历史日期显示当前设定的目标。

## 在 iPhone 上打开

在 Safari 打开[一日三量](https://waterlemo.github.io/daily-macros/)，通过分享菜单选择「添加到主屏幕」。之后可以从主屏幕图标打开应用。

## 本机试用

在项目目录运行 `python -m http.server 8000 --bind 127.0.0.1 --directory docs`，然后在浏览器打开 `http://127.0.0.1:8000/`。只做换算可以直接使用。选择「在本机试用」后，试用记录保存在当前浏览器。同步账户中的记录独立存储。

## 上线

1. 建立公开网站仓库并推送本项目。打开 GitHub 仓库的 **Settings → Pages**，选择 **Deploy from a branch → main → /docs**。记下网站的完整 HTTPS 地址，包含项目路径与末尾斜杠。
2. 创建独立的私有数据仓库，初始化 README 并保留默认分支。应用会把目标、常用食物和每天的记录写到这个仓库的 `settings.json`、`foods.json` 和 `records/YYYY-MM-DD.json`。
3. 用有 Cloudflare Workers 权限的账号运行 `npx wrangler deploy`，记下返回的 HTTPS Worker 地址。Cloudflare 只运行登录和读写接口，饮食记录写到 GitHub。
4. 在 GitHub 的 **Settings → Developer settings → GitHub Apps → New GitHub App** 注册一个应用。Homepage URL 使用网页地址，Callback URL 填 Worker 地址加 `/auth/callback`。关闭 Webhook，安装范围选择 **Only on this account**。在 **Repository permissions** 将 **Contents** 设为 **Read and write**。保存后把应用安装到刚才的私有数据仓库，只选这一个仓库。取得 GitHub App 的 **Client ID**，并生成一个 **Client secret**。
5. 在 Cloudflare Worker 的 **Settings → Variables and Secrets** 中填写下表。用 GitHub REST API 的 `GET /users/你的用户名` 查询自己的数字 `id`。可运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` 生成会话密钥，生成后直接录入 Worker 密钥设置。

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `SITE_URL` | 文本 | GitHub Pages 完整 HTTPS 首页地址 |
| `DATA_REPOSITORY` | 文本 | 私有数据仓库，格式为 `用户名/仓库名` |
| `GITHUB_USER_ID` | 文本 | 你的 GitHub 数字用户 ID |
| `GITHUB_CLIENT_ID` | 文本 | GitHub App 的 Client ID |
| `GITHUB_CLIENT_SECRET` | Secret | GitHub App 的 Client secret |
| `SESSION_KEY` | Secret | 32 字节随机密钥经 Base64URL 编码后的字符串 |

6. 将 `docs/config.mjs` 中的 `apiUrl` 改成 Worker 的 HTTPS 地址（末尾去掉斜杠），提交并推送。用手机打开网站，点击「GitHub 登录」，设置目标并添加一条记录。用另一台设备登录同一个账号，确认能读取该记录。请同时实测手机流量下能否完成登录和保存。

GitHub 授权信息只由 Worker 处理。浏览器在当前标签页保留最长八小时的加密会话，重新打开标签页时可以用 GitHub 再登录。数据仓库会保留 Git 提交历史，网页删除会移除当前记录。
