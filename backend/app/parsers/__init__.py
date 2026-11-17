"""多格式科研材料解析引擎（第二阶段）。

每个子模块导出 registry.py 约定的 parse_* 函数，全部遵循统一契约：
返回 app.schemas.parsing.ParseResult，其中每个 chunk 按材料类型使用专属 source_locator。
所有解析器只做静态解析，绝不执行用户代码。
"""
