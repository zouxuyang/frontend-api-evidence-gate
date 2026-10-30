import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const html = await readFile(new URL('./index.html', import.meta.url));
const orders = [
  { id: '1', orderNo: 'ORD-001', status: '待处理', amount: 1280, remark: '等待确认' },
  { id: '2', orderNo: 'ORD-002', status: '已完成', amount: 860, remark: '已发货' },
];

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4173');
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/orders') {
    const keyword = url.searchParams.get('keyword') ?? '';
    const items = orders.filter((order) => order.orderNo.includes(keyword));
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ items, page: Number(url.searchParams.get('page') ?? 1), pageSize: Number(url.searchParams.get('pageSize') ?? 20), total: items.length }));
    return;
  }
  if (request.method === 'PATCH' && url.pathname.startsWith('/api/orders/')) {
    const id = url.pathname.split('/').pop();
    const order = orders.find((item) => item.id === id);
    if (!order) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ message: '订单不存在' }));
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    Object.assign(order, JSON.parse(body));
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(order));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ message: 'Not found' }));
});

server.listen(4173, '127.0.0.1', () => console.log('quick-start listening on http://127.0.0.1:4173'));
