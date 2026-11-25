"""第十一阶段：统一多模型供应商架构。

对外只暴露抽象与网关；业务代码不得 import 任何厂商 SDK。
"""
from app.modelhub import errors as _errors  # noqa: F401 - 注册新增错误码
from app.modelhub.base import ModelAdapter, ModelRequest, ModelResponse
from app.modelhub.capabilities import Capability
from app.modelhub.gateway import ModelGateway, model_gateway

__all__ = ["ModelAdapter", "ModelRequest", "ModelResponse", "Capability",
           "ModelGateway", "model_gateway"]
