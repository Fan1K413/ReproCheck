"""Generate the AgentArts API plugin OpenAPI 3.0 document for a deployed backend."""
import argparse
import json
from urllib.parse import urlsplit

STRING = {"type": "string"}
CLAIM_FIELDS = ["batch_size", "learning_rate", "seed", "f1", "accuracy"]


def object_schema(properties: dict) -> dict:
    return {"type": "object", "properties": properties, "required": list(properties)}


def operation(name: str, description: str, body: dict, output: dict) -> dict:
    return {"post": {
        "operationId": name,
        "summary": description,
        "requestBody": {"required": True, "content": {"application/json": {"schema": body}}},
        "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": output}}}},
    }}


def build_spec(origin: str) -> dict:
    token_fields = {"run_id": STRING, "tool_token": STRING}
    claim = object_schema({"field": {"type": "string", "enum": CLAIM_FIELDS},
                           "chunk_id": STRING, "quote": STRING})
    claim_array = {"type": "array", "items": claim}
    kind_names = {"config": ("verifyConfig", "核对实验配置"),
                  "code": ("verifyCode", "静态核对随机种子"),
                  "metrics": ("verifyMetrics", "重算实验指标")}
    base = "/api/v1/agentarts/tools"
    paths = {f"{base}/context": operation(
        "getAuditContext", "获取本次审计的论文片段或复审主张", object_schema(token_fields),
        object_schema({"mode": STRING, "chunks": {"type": "array", "items":
                       object_schema({"chunk_id": STRING, "text": STRING})},
                       "review_claims": claim_array}),
    )}
    for kind, (name, description) in kind_names.items():
        paths[f"{base}/verify/{kind}"] = operation(
            name, description, object_schema({**token_fields, "claim": claim}),
            object_schema({"check_id": STRING, "status": STRING, "note": STRING}),
        )
    paths[f"{base}/finish"] = operation(
        "finishAudit", "提交本轮核验回执",
        object_schema({**token_fields, "check_ids": {"type": "array", "items": STRING}}),
        object_schema({"accepted": {"type": "boolean"}, "checked_count": {"type": "integer"}}),
    )
    return {"openapi": "3.0.3",
            "info": {"title": "ReproCheck 投稿前审计工具", "version": "1.0.0"},
            "servers": [{"url": origin}], "paths": paths}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("origin", help="Public HTTPS origin of the ReproCheck backend")
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if origin.scheme != "https" or not origin.hostname or origin.path not in ("", "/") or (
        origin.query or origin.fragment or origin.username or origin.password
    ):
        parser.error("use a bare HTTPS origin such as https://reprocheck.example.org")
    print(json.dumps(build_spec(args.origin.rstrip("/")), ensure_ascii=True, indent=2))
