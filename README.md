# hoa-prServer

一个对外提供 JSON 接口的服务端，用于 QQ bot / Web 端触发“智能化 PR”流程。

## 本地运行（WSL / Linux 推荐）

```bash
cd hoa-prServer
uv sync
uv run uvicorn hoa_prserver.app:app --host 0.0.0.0 --port 8000 --reload
```

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
- `GITHUB_TOKEN`：需要 repo 写权限（创建分支、push、开 PR）
- `API_KEY`：可选；设置后所有接口需携带 Header：`X-Api-Key: <API_KEY>`
- `HOA_PRSERVER_DB`：SQLite 路径（默认 `./data/hoa_prserver.sqlite3`）
- `POLL_INTERVAL_SECONDS`：轮询 pending 的周期（默认 3600 秒）

邮件提醒（可选，未配置会自动跳过）：
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` / `ADMIN_EMAIL`
