# 一日三量

手机端饮食记录工具。设置碳水、蛋白质和脂肪的每日目标，查看当天的已摄入、剩余或超出量。支持输入实际摄入量、按每 100 克换算、临时计算、常用食物和按日期回看。每日目标持续沿用，历史日期显示当前设定的目标。

## 在 iPhone 上打开

在 Safari 打开[一日三量](https://waterlemo.github.io/daily-macros/)，通过分享菜单选择「添加到主屏幕」。之后可以从主屏幕图标打开应用。

## 本机试用

在项目目录运行 `python -m http.server 8000 --bind 127.0.0.1 --directory docs`，然后在浏览器打开 `http://127.0.0.1:8000/`。只做换算可以直接使用。选择「在本机试用」后，试用记录保存在当前浏览器。同步账户中的记录独立存储。

## 部署同步接口

网页由 [GitHub Pages](https://waterlemo.github.io/daily-macros/) 发布，目录为 `main:/docs`。腾讯云 SCF 运行 GitHub 登录和同步接口，目标、常用食物和每日记录保存在私有数据仓库的 `settings.json`、`foods.json` 和 `records/YYYY-MM-DD.json`。

1. 运行 `python deploy/build-scf-zip.py daily-macros-scf.zip`。在与灶台相同的腾讯云北京地域创建独立的 `daily-macros-api-node20` Web 函数，选择 Node.js 20.19，上传 ZIP。代码包的启动脚本在端口 9000 启动 HTTP 服务。
2. 为该函数创建 HTTPS 公网函数 URL。函数 URL 的认证方式选「无认证」，让 GitHub 回调能访问，应用自己验证登录和数据请求。CORS 由应用处理。打开函数 URL 加 `/health`，应返回 `{"ok":true}`。
3. 在 GitHub 的 **Settings → Developer settings → GitHub Apps → New GitHub App** 注册应用。Homepage URL 使用网页地址，Callback URL 使用函数 URL 加 `/auth/callback`。关闭 Webhook，安装范围选择 **Only on this account**，允许 **Repository permissions → Contents → Read and write**。仅将应用安装到独立的私有数据仓库。保存应用的 **Client ID**，生成 **Client secret**。
4. 在腾讯云函数配置中填写以下环境变量。可用 GitHub REST API 的 `GET /users/你的用户名` 查询数字用户 ID。用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` 生成 `SESSION_KEY`，与 `GITHUB_CLIENT_SECRET` 一起直接填入腾讯云控制台。更新函数配置时保留现有密钥，轮换 `SESSION_KEY` 会使现有会话失效。

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `SITE_URL` | 文本 | GitHub Pages 完整 HTTPS 首页地址 |
| `API_URL` | 文本 | 腾讯云 HTTPS 函数 URL，末尾去掉斜杠 |
| `DATA_REPOSITORY` | 文本 | 私有数据仓库，格式为 `用户名/仓库名` |
| `GITHUB_USER_ID` | 文本 | 你的 GitHub 数字用户 ID |
| `GITHUB_CLIENT_ID` | 文本 | GitHub App 的 Client ID |
| `GITHUB_CLIENT_SECRET` | Secret | GitHub App 的 Client secret |
| `SESSION_KEY` | Secret | 32 字节随机密钥经 Base64URL 编码后的字符串 |

5. 用函数 URL 检查 `/auth/start` 已能进入 GitHub 授权，再将 `docs/config.mjs` 中的 `apiUrl` 设为与 `API_URL` 相同的函数地址并发布。用手机打开网站，点击「GitHub 登录」，设置目标并添加一条记录。用另一台设备登录同一个账号读回，并用手机流量验证登录和保存。

GitHub 授权信息只由腾讯云函数处理。浏览器在当前标签页保留最长八小时的加密会话，重新打开标签页时可以用 GitHub 再登录。数据仓库会保留 Git 提交历史，网页删除会移除当前记录。
