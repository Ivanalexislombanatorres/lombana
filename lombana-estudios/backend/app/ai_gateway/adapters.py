"""Adaptadores independientes por proveedor de IA.

Cada adaptador implementa: list_models() y chat(). Ninguno simula respuestas:
si no hay conexión o la clave es inválida, se devuelve el error real.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

TIMEOUT = httpx.Timeout(30.0, connect=8.0)


class AiError(RuntimeError):
    pass


@dataclass
class ChatResult:
    text: str
    model: str
    tokens_in: int
    tokens_out: int
    latency_ms: int


def _raise(r: httpx.Response) -> None:
    if r.status_code >= 400:
        try:
            body = r.json()
            msg = body.get("error", body)
            if isinstance(msg, dict):
                msg = msg.get("message") or msg
        except ValueError:
            msg = r.text[:300]
        hint = {401: "clave inválida", 403: "acceso denegado", 404: "recurso o modelo no encontrado",
                429: "límite de uso del proveedor alcanzado"}.get(r.status_code, "")
        raise AiError(f"HTTP {r.status_code} {hint}: {str(msg)[:300]}".strip())


class BaseAdapter:
    def __init__(self, base_url: str, api_key: str | None, extra: dict | None = None):
        self.base = base_url.rstrip("/")
        self.key = api_key
        self.extra = extra or {}

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=TIMEOUT)

    def _request(self, method: str, url: str, **kw) -> dict:
        try:
            with self._client() as c:
                r = c.request(method, url, **kw)
        except httpx.HTTPError as e:
            raise AiError(f"Sin conexión con el proveedor: {type(e).__name__}: {e}") from None
        _raise(r)
        return r.json()

    def list_models(self) -> list[str]:
        raise NotImplementedError

    def chat(self, model: str, system: str, prompt: str, max_tokens: int = 800) -> ChatResult:
        raise NotImplementedError


class OpenAICompatible(BaseAdapter):
    """OpenAI, Groq, DeepSeek, xAI, OpenRouter, Mistral y Ollama (API /v1 compatible)."""

    def _h(self) -> dict:
        return {"Authorization": f"Bearer {self.key}"} if self.key else {}

    def list_models(self) -> list[str]:
        data = self._request("GET", f"{self.base}/models", headers=self._h())
        return sorted(m["id"] for m in data.get("data", []))

    def chat(self, model, system, prompt, max_tokens=800):
        t = time.perf_counter()
        data = self._request("POST", f"{self.base}/chat/completions", headers=self._h(), json={
            "model": model, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]})
        u = data.get("usage") or {}
        return ChatResult(data["choices"][0]["message"]["content"] or "", data.get("model", model),
                          u.get("prompt_tokens", 0), u.get("completion_tokens", 0), int((time.perf_counter() - t) * 1000))


class Anthropic(BaseAdapter):
    def _h(self) -> dict:
        return {"x-api-key": self.key or "", "anthropic-version": "2023-06-01"}

    def list_models(self):
        data = self._request("GET", f"{self.base}/models", headers=self._h())
        return sorted(m["id"] for m in data.get("data", []))

    def chat(self, model, system, prompt, max_tokens=800):
        t = time.perf_counter()
        data = self._request("POST", f"{self.base}/messages", headers=self._h(), json={
            "model": model, "max_tokens": max_tokens, "system": system,
            "messages": [{"role": "user", "content": prompt}]})
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        u = data.get("usage") or {}
        return ChatResult(text, data.get("model", model), u.get("input_tokens", 0), u.get("output_tokens", 0),
                          int((time.perf_counter() - t) * 1000))


class Gemini(BaseAdapter):
    def _h(self) -> dict:
        return {"x-goog-api-key": self.key or ""}

    def list_models(self):
        data = self._request("GET", f"{self.base}/models", headers=self._h())
        return sorted(m["name"].removeprefix("models/") for m in data.get("models", [])
                      if "generateContent" in m.get("supportedGenerationMethods", []))

    def chat(self, model, system, prompt, max_tokens=800):
        t = time.perf_counter()
        data = self._request("POST", f"{self.base}/models/{model}:generateContent", headers=self._h(), json={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens}})
        cands = data.get("candidates") or []
        if not cands:
            raise AiError("El proveedor no devolvió respuesta (posible bloqueo de seguridad)")
        text = "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))
        u = data.get("usageMetadata") or {}
        return ChatResult(text, model, u.get("promptTokenCount", 0), u.get("candidatesTokenCount", 0),
                          int((time.perf_counter() - t) * 1000))


class Cohere(BaseAdapter):
    def _h(self) -> dict:
        return {"Authorization": f"Bearer {self.key}"}

    def list_models(self):
        data = self._request("GET", f"{self.base}/v1/models", headers=self._h(), params={"endpoint": "chat"})
        return sorted(m["name"] for m in data.get("models", []))

    def chat(self, model, system, prompt, max_tokens=800):
        t = time.perf_counter()
        data = self._request("POST", f"{self.base}/v2/chat", headers=self._h(), json={
            "model": model, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]})
        text = "".join(c.get("text", "") for c in data.get("message", {}).get("content", []))
        u = (data.get("usage") or {}).get("tokens", {})
        return ChatResult(text, model, int(u.get("input_tokens", 0)), int(u.get("output_tokens", 0)),
                          int((time.perf_counter() - t) * 1000))


class AzureOpenAI(BaseAdapter):
    """base_url = https://<recurso>.openai.azure.com ; el 'modelo' es el nombre del deployment."""

    def _h(self) -> dict:
        return {"api-key": self.key or ""}

    @property
    def _ver(self) -> str:
        return self.extra.get("api_version", "2024-10-21")

    def list_models(self):
        deps = [d.strip() for d in self.extra.get("deployments", "").split(",") if d.strip()]
        if not deps:
            raise AiError("Indica al menos un deployment en la configuración de Azure")
        self.chat(deps[0], "Responde solo OK.", "ping", max_tokens=5)  # prueba real
        return deps

    def chat(self, model, system, prompt, max_tokens=800):
        t = time.perf_counter()
        data = self._request("POST", f"{self.base}/openai/deployments/{model}/chat/completions",
                             headers=self._h(), params={"api-version": self._ver}, json={
                                 "max_tokens": max_tokens,
                                 "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]})
        u = data.get("usage") or {}
        return ChatResult(data["choices"][0]["message"]["content"] or "", model, u.get("prompt_tokens", 0),
                          u.get("completion_tokens", 0), int((time.perf_counter() - t) * 1000))


ADAPTERS = {"openai_compatible": OpenAICompatible, "anthropic": Anthropic, "gemini": Gemini, "cohere": Cohere,
            "azure_openai": AzureOpenAI}

# Proveedores preconfigurados (solo plantillas: no están "conectados" hasta probarlos con una clave real)
PRESETS = [
    {"code": "openai", "name": "OpenAI", "kind": "openai_compatible", "base_url": "https://api.openai.com/v1", "needs_key": True},
    {"code": "anthropic", "name": "Anthropic Claude", "kind": "anthropic", "base_url": "https://api.anthropic.com/v1", "needs_key": True},
    {"code": "gemini", "name": "Google Gemini", "kind": "gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta", "needs_key": True},
    {"code": "mistral", "name": "Mistral", "kind": "openai_compatible", "base_url": "https://api.mistral.ai/v1", "needs_key": True},
    {"code": "cohere", "name": "Cohere", "kind": "cohere", "base_url": "https://api.cohere.com", "needs_key": True},
    {"code": "groq", "name": "Groq", "kind": "openai_compatible", "base_url": "https://api.groq.com/openai/v1", "needs_key": True},
    {"code": "deepseek", "name": "DeepSeek", "kind": "openai_compatible", "base_url": "https://api.deepseek.com/v1", "needs_key": True},
    {"code": "xai", "name": "xAI", "kind": "openai_compatible", "base_url": "https://api.x.ai/v1", "needs_key": True},
    {"code": "openrouter", "name": "OpenRouter", "kind": "openai_compatible", "base_url": "https://openrouter.ai/api/v1", "needs_key": True},
    {"code": "azure_openai", "name": "Azure OpenAI", "kind": "azure_openai", "base_url": "https://TU-RECURSO.openai.azure.com", "needs_key": True},
    {"code": "ollama", "name": "Ollama (IA local)", "kind": "openai_compatible", "base_url": "http://localhost:11434/v1", "needs_key": False},
]


def build(kind: str, base_url: str, api_key: str | None, extra: dict | None) -> BaseAdapter:
    if kind not in ADAPTERS:
        raise AiError(f"Tipo de proveedor no soportado: {kind}")
    return ADAPTERS[kind](base_url, api_key, extra)
