# hoa-prServer

一个对外提供 JSON 接口的服务端，用于 QQ bot / Web 端触发“智能化 PR”流程。

## 本地运行（WSL / Linux 推荐）

```bash
cd hoa-prServer
uv sync
uv run uvicorn hoa_prserver.app:app --host 0.0.0.0 --port 8000 --reload
```

## Docker（WSL 测试）

在 WSL 里进入仓库目录后：

```bash
docker build -t hoa-prserver:dev .
docker run --rm -p 8000:8000 \
  -e ORG_NAME=HITSZ-OpenAuto \
  -e ALLOWED_REPOS=TEST1001 \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -e API_KEY="$API_KEY" \
  -v "$(pwd)/data:/data" \
  hoa-prserver:dev
```

或者用 compose：

```bash
docker compose up --build
```

说明：容器里包含 `git`，用于自动 clone/push 开 PR；SQLite 默认挂载到 `./data/`。

## API

- `GET /health`
  - 返回服务状态

- `POST /v1/readme/render`
  - 入参：`{ "toml": "..." }`
  - 出参：`{ "readme_md": "..." }`

### 仓库查询 / 提交 PR

这些接口用于 Web/QQ bot 完成“查仓库 -> 拿/编辑 TOML -> 服务端生成 README 并自动开 PR”。

- `GET /v1/org/repos?q=&limit=`
  - 列出组织下仓库（可用 `q` 做简单过滤）

- `GET /v1/courses/lookup?course_code=...&course_name=...&repo_type=normal|multi-project`
  - 若仓库存在：返回 `repo` 基础字段 + 仓库里的 `readme.toml`（若不存在则返回模板）
  - 若仓库不存在：返回模板 TOML，`exists=false`

- `POST /v1/courses/submit`
  - 入参：`{ course_code, course_name, repo_type, toml }`
  - 若仓库存在：创建分支、写入 `readme.toml` + 生成 `README.md`、push 并开 PR，返回 `pr_url`
  - 若仓库不存在：写入 pending 队列并（可选）发邮件提醒管理员创建仓库，返回 `request_id`

- `GET /v1/requests/{request_id}`
  - 查询 pending 状态（`waiting_repo` / `pr_created` / `failed` 等）

## 环境变量

- `ORG_NAME`：GitHub 组织名（默认 `HITSZ-OpenAuto`）
- `ALLOWED_REPOS`：可选；仓库白名单（逗号分隔）。设置后仅允许这些 repo（例如测试期：`TEST1001`）
- `GITHUB_TOKEN`：需要 repo 写权限（创建分支、push、开 PR）
- `API_KEY`：可选；设置后所有接口需携带 Header：`X-Api-Key: <API_KEY>`
- `HOA_PRSERVER_DB`：SQLite 路径（默认 `./data/hoa_prserver.sqlite3`）
- `POLL_INTERVAL_SECONDS`：轮询 pending 的周期（默认 3600 秒）

邮件提醒（可选，未配置会自动跳过）：
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` / `ADMIN_EMAIL`

## 代码结构（每个文件是干什么的）

- `src/hoa_prserver/app.py`：FastAPI 路由 + 启动时的 pending 轮询任务
- `src/hoa_prserver/github_client.py`：GitHub REST API（列仓库 / 查仓库 / 读文件 / 开 PR）
- `src/hoa_prserver/pr_flow.py`：clone -> 写 TOML -> 生成 README -> commit/push -> 开 PR
- `src/hoa_prserver/render.py`：纯渲染能力（把 TOML 转为 README.md 文本）
- `src/hoa_prserver/db.py`：SQLite pending_requests 表（仓库不存在时入队等待）
- `src/hoa_prserver/settings.py`：从环境变量加载配置
- `src/hoa_prserver/auth.py`：可选 API Key（Header `X-Api-Key`）
- `src/hoa_prserver/emailer.py`：SMTP 发邮件提醒管理员（可选）
- `src/hoa_prserver/toml_templates.py`：normal / multi-project 的最小模板
- `scripts/convert_toml_to_readme.py`：与 RDME 工具链一致的 TOML->README 转换脚本
