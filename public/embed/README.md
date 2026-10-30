# 本地嵌入资产（bge-small-zh-v1.5 q8）

这些文件不随仓库分发，由 `node scripts/fetch-model.mjs` 预取并校验 SHA-256：

- `embed/transformers.web.min.js`：transformers.js 3.7.5 浏览器包
- `embed/ort-wasm-simd-threaded.jsep.{wasm,mjs}`：onnxruntime-web wasm
- `models/bge-small-zh-v1.5/`：config / tokenizer / `onnx/model_quantized.onnx`

浏览器侧在 `src/workers/embed.worker.ts` 里按需动态加载；模型缺失时
`src/lib/embedLocal.ts` 返回 `reason: "model-missing"`，知识库检索退回 BM25，
主流程不受影响。Node 侧可用 `node scripts/precheck-embed.mjs` 自检推理是否可用。
