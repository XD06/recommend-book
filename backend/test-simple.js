const API = 'http://localhost:3001/api';
const lib = [
  {id:'b1',title:'深入理解计算机系统',author:'Bryant',category:'计算机科学',status:'reading',aiInsight:{summary:'经典CS教材。'},createdAt:'2024-01-01',updatedAt:'2024-01-01'},
];
fetch(API + '/ai/recommend', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({userRequest:'推荐书', library:lib}),
}).then(r => r.text()).then(text => console.log('Response:', text)).catch(e => console.error('Error:', e.message));