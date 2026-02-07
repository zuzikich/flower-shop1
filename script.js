let cart = [];
let products = [];
let categories = [];
let currentCategory = 'all';

async function init() {
    try {
        const [resP, resC] = await Promise.all([fetch('/api/products'), fetch('/api/categories')]);
        products = await resP.json();
        categories = await resC.json();
        
        renderCategories();
        render();
        updateCount();
    } catch(e) { console.error(e); }
}

function renderCategories() {
    const box = document.getElementById('categories-container');
    box.innerHTML = '';

    const allBtn = document.createElement('div');
    allBtn.className = `cat-item ${currentCategory === 'all' ? 'active-all' : ''}`;
    if (currentCategory !== 'all') allBtn.style.background = '#ddd';
    allBtn.innerHTML = `<div class="cat-text">ВСЕ</div>`;
    allBtn.onclick = () => filterByCategory('all');
    box.appendChild(allBtn);

    categories.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'cat-item';
        div.innerHTML = `<img src="/api/category-image/${cat.id}" class="cat-img"><div class="cat-overlay"></div><div class="cat-text">${cat.title}</div>`;
        div.onclick = () => filterByCategory(cat.id);
        box.appendChild(div);
    });
}

function filterByCategory(id) {
    currentCategory = id;
    renderCategories();
    render();
}

function render() {
    const box = document.getElementById('catalog');
    box.innerHTML = '';
    
    const filtered = currentCategory === 'all' ? products : products.filter(p => p.category_id == currentCategory);

    if (!filtered.length) {
        box.innerHTML = '<p style="text-align:center; width:100%;">В этой категории пока пусто</p>';
        return;
    }

    filtered.forEach((p, index) => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.animationDelay = `${index * 0.1}s`;
        
        div.innerHTML = `
            <img src="/api/image/${p.id}">
            <div class="card-body">
                <div class="card-title">${p.title}</div>
                <div class="card-price">${p.price} ₽</div>
                <div class="btns-row" id="btn-container-${p.id}">${getBtnHTML(p)}</div>
            </div>`;
        box.appendChild(div);
    });
}

function getBtnHTML(p) {
    const inCart = cart.find(c => c.id === p.id);
    const qty = inCart ? inCart.qty : 0;
    if (qty > 0) {
        return `<div class="qty-ctrl"><button class="qty-btn" onclick="upd(${p.id},-1)">−</button><span>${qty} в корзине</span><button class="qty-btn" onclick="upd(${p.id},1)">+</button></div><button class="btn-outline" onclick="openDetails(${p.id})">Подробнее</button>`;
    } else {
        const dis = p.stock === 0 ? 'disabled style="opacity:0.5"' : '';
        const txt = p.stock === 0 ? 'Нет в наличии' : 'В корзину';
        const act = p.stock > 0 ? `upd(${p.id}, 1)` : '';
        return `<button class="btn-pink" onclick="${act}" ${dis}>${txt}</button><button class="btn-outline" onclick="openDetails(${p.id})">Подробнее</button>`;
    }
}

function updateCardButton(id) {
    const p = products.find(i => i.id === id);
    if (!p) return;
    const cont = document.getElementById(`btn-container-${id}`);
    if (cont) cont.innerHTML = getBtnHTML(p);
}

function upd(id, d) {
    const p = products.find(i => i.id === id);
    let item = cart.find(c => c.id === id);
    if (!item) { if (d > 0) cart.push({...p, qty: 1}); }
    else {
        const n = item.qty + d;
        if (n > p.stock) return alert('Ограничено складом!');
        if (n <= 0) cart = cart.filter(c => c.id !== id);
        else item.qty = n;
    }
    updateCardButton(id); renderCart(); updateCount();
    if(!document.getElementById('product-modal').classList.contains('hidden')) updateDetailsButtons(id);
}

function renderCart() {
    const box = document.getElementById('cart-items');
    box.innerHTML = '';
    let tot = 0;
    if (!cart.length) box.innerHTML = '<p style="text-align:center;color:#999;">Корзина пуста</p>';
    cart.forEach(i => {
        tot += i.price * i.qty;
        box.innerHTML += `
            <div class="cart-item-design">
                <img src="/api/image/${i.id}">
                <div class="cart-info-col"><h3>${i.title}</h3></div>
                <div class="cart-qty-col"><div class="circle-btn" onclick="upd(${i.id}, -1)">–</div><div class="qty-val">${i.qty}</div><div class="circle-btn" onclick="upd(${i.id}, 1)">+</div></div>
                <div class="cart-price-col">${(i.price * i.qty).toLocaleString()} р.</div>
                <div class="cart-remove-col" onclick="upd(${i.id}, -${i.qty})"><span class="material-icons" style="font-size:16px;">close</span></div>
            </div>`;
    });
    document.getElementById('total-price').innerText = tot.toLocaleString();
}

function updateCount() { document.getElementById('cart-count').innerText = cart.reduce((s,i)=>s+i.qty,0); }
function toggleCart() { document.getElementById('cart-modal').classList.toggle('hidden'); renderCart(); }
function toggleContactModal() { document.getElementById('contact-modal-overlay').classList.toggle('hidden'); document.getElementById('contact-widget').classList.toggle('hidden'); }
function closeProductModal() { document.getElementById('product-modal').classList.add('hidden'); }

function openDetails(id) {
    const p = products.find(i => i.id === id);
    if(!p) return;
    document.getElementById('modal-img').src = `/api/image/${p.id}`;
    document.getElementById('modal-title').innerText = p.title;
    document.getElementById('modal-price').innerText = p.price;
    document.getElementById('modal-desc').innerText = p.description || "";
    document.getElementById('product-modal').dataset.activeId = id;
    updateDetailsButtons(id);
    document.getElementById('product-modal').classList.remove('hidden');
}

function updateDetailsButtons(id) {
    const m = document.getElementById('product-modal');
    if (m.dataset.activeId != id) return;
    const p = products.find(i => i.id === id);
    const acts = document.getElementById('modal-actions');
    const inCart = cart.find(c => c.id === id);
    const qty = inCart ? inCart.qty : 0;
    if (qty > 0) acts.innerHTML = `<div class="qty-ctrl" style="background:var(--pink);justify-content:center;gap:20px;"><button class="qty-btn" onclick="upd(${p.id},-1)">−</button><span style="font-size:1.2rem">${qty}</span><button class="qty-btn" onclick="upd(${p.id},1)">+</button></div>`;
    else acts.innerHTML = `<button class="btn-pink" onclick="upd(${p.id},1)">В корзину</button>`;
}

// --- ИСПРАВЛЕННЫЙ КОД ДЛЯ КОНЦА ФАЙЛА ---

// Ждем, пока прогрузится весь HTML, и только потом запускаем скрипт
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Сначала запускаем загрузку товаров
    init();

    // 2. Настраиваем кнопку "В каталог" (плавная прокрутка)
    const btnBanner = document.querySelector('.btn-banner');
    if (btnBanner) {
        btnBanner.addEventListener('click', function(e) {
            e.preventDefault();
            const sec = document.getElementById('catalog');
            if (sec) {
                // Вычисляем позицию с учетом отступа шапки
                // Увеличили отступ, чтобы захватить категории и заголовок
             const off = sec.getBoundingClientRect().top + window.scrollY - 300;
                window.scrollTo({ top: off, behavior: "smooth" });
            }
        });
    }

    // 3. Настраиваем форму отправки заказа
    const orderForm = document.getElementById('order-form');
    if (orderForm) {
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!cart.length) return alert('Корзина пуста');
            
            // Собираем данные формы
            const nameField = document.getElementById('name');
            const phoneField = document.getElementById('phone');
            const detailsField = document.getElementById('details');

            const data = {
                name: nameField ? nameField.value : '',
                phone: phoneField ? phoneField.value : '',
                details: detailsField ? detailsField.value : '',
                cart: cart
            };

            try {
                const res = await fetch('/api/orders', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                const json = await res.json();
                
                if (json.success) {
                    alert('Заказ принят!');
                    cart = []; // Очищаем корзину
                    render(); // Перерисовываем каталог (обновляем кнопки)
                    toggleCart(); // Закрываем корзину
                    updateCount(); // Обновляем счетчик
                } else {
                    alert('Ошибка: ' + (json.error || 'Что-то пошло не так'));
                }
            } catch (err) {
                console.error(err);
                alert('Ошибка соединения с сервером');
            }
        });
    }
});