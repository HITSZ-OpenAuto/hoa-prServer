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

> 后续会在这个仓库里继续补全：GitHub 鉴权、分支提交、创建 PR、以及 job 队列等能力。
