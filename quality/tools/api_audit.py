"""ReproCheck 独立质量审计：API 鉴权、隔离与读写边界实测。

用途：对已运行的后端（默认 http://127.0.0.1:8000）发起真实 HTTP 请求，
记录匿名可读、跨角色/跨项目越权、上传/解析/删除链路结果，并清理临时数据。

约束：
- 只使用演示账号与临时 QA 项目；项目名带 QA-AUDIT 前缀，结束时删除。
- 不修改仓库源码，不写业务库以外的文件。
- 结果写 JSON，供 quality/API_AUDIT.md 引用。

运行：
    backend\\.venv\\Scripts\\python quality\\tools\\api_audit.py
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8000/api/v1"
DEMO_PROJECT = "proj-209c77cd39f94212"
PASSWORD = "ReproCheck#2026"
OUT = Path(__file__).resolve().parents[1] / "reports" / "api-audit.json"


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def call(client: httpx.Client, method: str, path: str, **kw) -> tuple[int, dict | None, float]:
    t0 = time.perf_counter()
    r = client.request(method, path, **kw)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    try:
        body = r.json()
    except Exception:
        body = None
    return r.status_code, body, ms


def data(body: dict | None) -> dict:
    return (body or {}).get("data") or {}


def main() -> int:
    results: dict = {"started_at": now(), "base": BASE, "probes": [], "cleanup": []}
    with httpx.Client(base_url=BASE, timeout=30) as anon:
        # 1) 匿名读
        st, body, ms = call(anon, "GET", "/projects")
        results["probes"].append({"id": "anon.list_projects", "status": st, "ms": ms,
                                  "total": data(body).get("total"), "expected": "401/403"})
        st, body, ms = call(anon, "GET", "/materials", params={"project_id": DEMO_PROJECT})
        results["probes"].append({"id": "anon.list_materials", "status": st, "ms": ms,
                                  "total": data(body).get("total"), "expected": "401/403"})
        st, body, ms = call(anon, "GET", "/parse-tasks", params={"project_id": DEMO_PROJECT})
        results["probes"].append({"id": "anon.list_parse_tasks", "status": st, "ms": ms,
                                  "total": data(body).get("total"), "expected": "401/403"})
        # 2) 匿名下载（取匿名列表里的第一条，仅记录字节数，不保存内容）
        st, body, ms = call(anon, "GET", "/materials", params={"project_id": DEMO_PROJECT})
        items = data(body).get("items") or []
        if items:
            mid = items[0]["material_id"]
            t0 = time.perf_counter()
            r = anon.get(f"/materials/{mid}/download")
            results["probes"].append({"id": "anon.download_material", "status": r.status_code,
                                      "bytes": len(r.content), "ms": round((time.perf_counter() - t0) * 1000, 1),
                                      "expected": "401/403"})
        # 3) 无效 token
        r = anon.get("/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
        results["probes"].append({"id": "invalid_token.me", "status": r.status_code, "expected": 401})

    # 登录
    tokens: dict[str, str] = {}
    with httpx.Client(base_url=BASE, timeout=30) as c:
        for role in ("lead", "researcher", "reviewer", "viewer"):
            email = f"{role}@reprocheck.demo"
            st, body, ms = call(c, "POST", "/auth/login", json={"email": email, "password": PASSWORD})
            if st != 200:
                results["probes"].append({"id": f"login.{role}", "status": st, "ok": False})
                continue
            tokens[role] = data(body)["token"]
            results["probes"].append({"id": f"login.{role}", "status": st, "ok": True, "ms": ms})

    if "lead" not in tokens:
        results["error"] = "lead 登录失败，终止"
        OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        return 1

    lead_h = {"Authorization": f"Bearer {tokens['lead']}"}
    viewer_h = {"Authorization": f"Bearer {tokens['viewer']}"} if "viewer" in tokens else {}

    project_id = None
    with httpx.Client(base_url=BASE, timeout=60) as c:
        # 4) 创建临时项目（lead）
        st, body, ms = call(c, "POST", "/projects", headers=lead_h,
                            json={"name": f"QA-AUDIT 质量门禁临时项目 {now()}",
                                  "domain": "QA", "paper_title": "QA probe",
                                  "description": "独立质量审计临时项目，结束即删除"})
        project = data(body)
        project_id = project.get("id")
        results["probes"].append({"id": "lead.create_project", "status": st, "project_id": project_id, "ms": ms})

        if project_id:
            # 5) 非成员 viewer 上传（期望 403/404）
            sample = Path("backend/test_materials/stage2/sample.pdf")
            sample_bytes = sample.read_bytes()
            st, body, ms = call(c, "POST", "/materials/upload", headers=viewer_h,
                                data={"project_id": project_id},
                                files={"file": ("qa-viewer-probe.pdf", sample_bytes, "application/pdf")})
            viewer_mat = data(body).get("material_id")
            results["probes"].append({"id": "viewer.upload_non_member", "status": st,
                                      "material_id": viewer_mat, "ms": ms, "expected": "403/404"})

            # 6) 匿名上传（期望 401）
            st, body, ms = call(c, "POST", "/materials/upload",
                                data={"project_id": project_id},
                                files={"file": ("qa-anon-probe.txt", b"qa probe\n", "text/plain")})
            anon_mat = data(body).get("material_id")
            results["probes"].append({"id": "anon.upload", "status": st,
                                      "material_id": anon_mat, "ms": ms, "expected": "401"})

            # 7) viewer 发起解析（期望 403）
            if viewer_mat:
                st, body, ms = call(c, "POST", f"/materials/{viewer_mat}/parse", headers=viewer_h)
                results["probes"].append({"id": "viewer.start_parse", "status": st,
                                          "task_status": data(body).get("status"), "ms": ms,
                                          "expected": "403"})

            # 8) viewer 删除项目（期望 403/404）
            st, body, ms = call(c, "DELETE", f"/projects/{project_id}", headers=viewer_h)
            results["probes"].append({"id": "viewer.delete_project", "status": st, "ms": ms,
                                      "expected": "403/404"})

            # 8b) viewer 对“自己是成员”的演示项目上传（期望 403）
            viewer_member_mat = None
            if viewer_h:
                st, body, ms = call(c, "POST", "/materials/upload", headers=viewer_h,
                                    data={"project_id": DEMO_PROJECT},
                                    files={"file": ("qa-viewer-rbac-probe.txt", b"viewer rbac probe\n", "text/plain")})
                viewer_member_mat = data(body).get("material_id")
                results.setdefault("supplemental_probes", []).append({
                    "id": "viewer.upload_member", "status": st, "material_id": viewer_member_mat,
                    "ms": ms, "expected": "403"})
                # 8c) 匿名删除该探针材料（期望 401）
                if viewer_member_mat:
                    st, body, ms = call(c, "DELETE", f"/materials/{viewer_member_mat}")
                    results["supplemental_probes"].append({
                        "id": "anon.delete_material", "status": st, "ms": ms, "expected": "401"})
                    if st != 200:
                        results["cleanup"].append({"material": viewer_member_mat, "delete_status": "not_deleted_by_anon"})

            # 9) 清理：lead 删除材料与项目
            for mid in [x for x in (viewer_mat, anon_mat, viewer_member_mat) if x]:
                st, body, ms = call(c, "DELETE", f"/materials/{mid}", headers=lead_h)
                results["cleanup"].append({"material": mid, "delete_status": st})
            st, body, ms = call(c, "DELETE", f"/projects/{project_id}", headers=lead_h)
            results["cleanup"].append({"project": project_id, "delete_status": st,
                                       "materials_removed": data(body).get("materials_removed")})

        # 10) 各角色可见项目数（隔离读数）
        for role, h in (("lead", lead_h), ("viewer", viewer_h)):
            if not h:
                continue
            st, body, ms = call(c, "GET", "/projects", headers=h)
            results["probes"].append({"id": f"{role}.list_projects", "status": st,
                                      "total": data(body).get("total"), "ms": ms})

    results["finished_at"] = now()
    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
