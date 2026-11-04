const html = `const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>虚构行星 · 轻量版</title>
<style>
  html, body { margin: 0; height: 100%; background: #05080f; color: #dce8f2; overflow: hidden; font: 14px/1.6 "Microsoft YaHei", sans-serif; }
  #topbar { position: fixed; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: linear-gradient(#0b1220f2, #0b1220c8); border-bottom: 1px solid #22303f; z-index: 10; }
  #topbar b { color: #8fd0ff; font-size: 15px; letter-spacing: 1px; }
  select, button { background: #16222f; color: #dce8f2; border: 1px solid #33506b; border-radius: 6px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .modes { display: flex; gap: 4px; }
  .modes button.on { background: #2563a8; color: #fff; border-color: #3a6ea8; }
  .tgl { display: flex; gap: 8px; margin-left: auto; }
  .tgl label { display: flex; align-items: center; gap: 3px; font-size: 12px; color: #9db4ca; cursor: pointer; }
  .tgl input { accent-color: #3aa0ff; }
  #tagline { position: fixed; top: 58px; left: 14px; z-index: 9; font-size: 12px; color: #7e94ab; max-width: 70vw; text-shadow: 0 1px 3px #000; }
  #stats { position: fixed; bottom: 12px; left: 14px; z-index: 9; font-size: 11.5px; color: #8aa4bd; background: #0b1220d9; border: 1px solid #22303f; border-radius: 8px; padding: 6px 12px; max-width: 46vw; }
`;