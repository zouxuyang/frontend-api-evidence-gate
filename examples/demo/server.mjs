import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const orders = [
  { id: '1', orderNo: 'ORD-001', status: '待处理', amount: 1280, remark: '优先配送' },
  { id: '2', orderNo: 'ORD-002', status: '已完成', amount: 860, remark: '普通配送' },
];
const html = await readFile(new URL('./index.html', import.meta.url));
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4173');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/bad')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(url.pathname === '/bad' ? await readFile(new URL('./bad-page/index.html', import.meta.url)) : html); return; }
  if (req.method === 'GET' && url.pathname === '/api/orders') {
    const keyword = url.searchParams.get('keyword') ?? '';
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = orders.filter((order) => order.orderNo.includes(keyword));
    res.end(JSON.stringify({ items: filtered, page, pageSize, total: filtered.length })); return;
  }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/orders/')) {
    let body = ''; for await (const chunk of req) body += chunk;
    const order = orders.find((item) => item.id === url.pathname.split('/').pop());
    const payload = JSON.parse(body);
    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) { res.statusCode = 422; res.end(JSON.stringify({ message: '字段 notes 不符合 API 契约，应使用 remark' })); return; }
    Object.assign(order, payload);
    res.end(JSON.stringify(order)); return;
  }
  res.statusCode = 404; res.end(JSON.stringify({ message: 'Not found' }));
});
server.listen(4173, '127.0.0.1', () => console.log('demo listening on http://127.0.0.1:4173'));
