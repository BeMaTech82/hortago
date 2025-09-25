import localforage from 'localforage';
import './style.css';

// Configuration du stockage
const storage = {
  async setItem(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  async getItem(key) {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  }
};

// Gestionnaire de géolocalisation simple pour le rayon
class LocationManager {
  async getLocation() {
    // Essayer IP d'abord (plus fiable)
    try {
      const response = await fetch('https://ipapi.co/json/')
      if (response.ok) {
        const data = await response.json()
        return {
          lat: data.latitude,
          lon: data.longitude,
          city: data.city,
          region: data.region,
          country: data.country_name,
          source: 'IP'
        }
      }
    } catch (error) {
      console.log('IP location failed, trying GPS...')
    }

    // Fallback GPS si IP échoue
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Géolocalisation non supportée'))
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
            source: 'GPS'
          })
        },
        reject,
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      )
    })
  }

  // Calculer distance entre deux points
  calculateDistance(pos1, pos2) {
    const R = 6371 // Rayon terre en km
    const dLat = this.toRad(pos2.lat - pos1.lat)
    const dLon = this.toRad(pos2.lon - pos1.lon)
    const lat1 = this.toRad(pos1.lat)
    const lat2 = this.toRad(pos2.lat)

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.sin(dLon/2) * Math.sin(dLon/2) *
              Math.cos(lat1) * Math.cos(lat2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  toRad(value) {
    return value * Math.PI / 180
  }

  // Trouver utilisateurs dans un rayon
  findUsersInRadius(centerLat, centerLon, radiusKm, users) {
    return users.filter(user => {
      if (!user.location) return false
      const distance = this.calculateDistance(
        { lat: centerLat, lon: centerLon },
        { lat: user.location.lat, lon: user.location.lon }
      )
      return distance <= radiusKm
    })
  }
}

// Gestionnaire de produits
class ProductManager {
  constructor() {
    this.categories = [
      'Fruits', 'Légumes', 'Céréales', 'Légumineuses',
      'Herbes aromatiques', 'Fleurs', 'Œufs', 'Produits laitiers',
      'Miel', 'Conserves', 'Autres'
    ]
  }

  async saveProduct(productData) {
    try {
      let products = await localforage.getItem('products') || []
      const product = {
        id: Date.now(),
        ...productData,
        createdAt: Date.now(),
        status: 'disponible' // disponible, vendu, expiré
      }

      products.unshift(product)
      await localforage.setItem('products', products)
      return product
    } catch (error) {
      console.error('Erreur sauvegarde produit:', error)
      throw error
    }
  }

  async getProducts() {
    try {
      return await localforage.getItem('products') || []
    } catch (error) {
      console.error('Erreur chargement produits:', error)
      return []
    }
  }

  async updateProductStatus(productId, status) {
    try {
      let products = await this.getProducts()
      products = products.map(p =>
        p.id === productId ? { ...p, status, updatedAt: Date.now() } : p
      )
      await localforage.setItem('products', products)
      return true
    } catch (error) {
      console.error('Erreur mise à jour produit:', error)
      return false
    }
  }

  // Recherche produits par catégorie et localisation
  searchProducts(products, filters) {
    return products.filter(product => {
      // Filtre statut
      if (product.status !== 'disponible') return false

      // Filtre catégorie
      if (filters.category && filters.category !== 'all' &&
          product.category !== filters.category) return false

      // Filtre recherche texte
      if (filters.search) {
        const search = filters.search.toLowerCase()
        const text = `${product.name} ${product.description}`.toLowerCase()
        if (!text.includes(search)) return false
      }

      return true
    })
  }
}

// Gestionnaire de notifications
class NotificationManager {
  constructor() {
    this.requestPermission()
  }

  async requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  }

  async sendNotification(title, body, data = {}) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/la-generation-didees.png',
        badge: '/la-generation-didees.png',
        data,
        requireInteraction: true
      })
    }
  }

  // Notifier acheteurs intéressés par un nouveau produit
  async notifyBuyers(product, locationManager) {
    try {
      // Récupérer les recherches sauvegardées
      const searches = await localforage.getItem('savedSearches') || []
      const users = await localforage.getItem('users') || []

      // Trouver les recherches matchant le produit
      const matchingSearches = searches.filter(search =>
        !search.category || search.category === 'all' || search.category === product.category
      )

      // Pour chaque recherche, vérifier si l'utilisateur est dans le rayon
      for (const search of matchingSearches) {
        if (product.location && search.userId) {
          const user = users.find(u => u.id === search.userId)
          if (user && user.location) {
            const distance = locationManager.calculateDistance(
              product.location,
              user.location
            )

            if (distance <= search.radius) {
              await this.sendNotification(
                `Nouveau produit disponible !`,
                `${product.name} - ${product.category} à ${distance.toFixed(1)}km de vous`,
                { productId: product.id, distance }
              )
            }
          }
        }
      }
    } catch (error) {
      console.error('Erreur notification:', error)
    }
  }
}

// Gestionnaire d'utilisateurs
class UserManager {
  async getCurrentUser() {
    return await localforage.getItem('currentUser')
  }

  async saveUser(userData) {
    try {
      let users = await localforage.getItem('users') || []
      const user = {
        id: Date.now(),
        ...userData,
        createdAt: Date.now()
      }

      users.push(user)
      await localforage.setItem('users', users)
      await localforage.setItem('currentUser', user)
      return user
    } catch (error) {
      console.error('Erreur sauvegarde utilisateur:', error)
      throw error
    }
  }

  async saveBuyerSearch(searchData) {
    try {
      let searches = await localforage.getItem('savedSearches') || []
      const search = {
        id: Date.now(),
        ...searchData,
        createdAt: Date.now()
      }

      searches.unshift(search)
      await localforage.setItem('savedSearches', searches)
      return search
    } catch (error) {
      console.error('Erreur sauvegarde recherche:', error)
      throw error
    }
  }
}

// Application principale
class MarketplacePWA {
  constructor() {
    this.isOnline = navigator.onLine
    this.installPrompt = null
    this.currentUser = null
    this.userLocation = null

    this.locationManager = new LocationManager()
    this.productManager = new ProductManager()
    this.notificationManager = new NotificationManager()
    this.userManager = new UserManager()

    this.currentView = 'home'
    this.init()
  }

  async init() {
    await this.setupPWA()
    this.setupEventListeners()
    this.updateStatus()
    await this.loadUser()
    this.showView('home')
  }

  async setupPWA() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js', { scope: './' })
        console.log('Service Worker enregistré')
      } catch (error) {
        console.log('Erreur Service Worker:', error)
      }
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      this.installPrompt = e
      document.getElementById('install-btn')?.classList.remove('hidden')
    })
  }

  setupEventListeners() {
    // Navigation
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-view]')) {
        e.preventDefault()
        this.showView(e.target.dataset.view)
      }
    })

    // PWA
    document.getElementById('install-btn')?.addEventListener('click', () => this.installApp())
    window.addEventListener('online', () => this.handleOnline())
    window.addEventListener('offline', () => this.handleOffline())

    // Formulaires
    document.getElementById('seller-form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      this.handleSellerSubmit(e)
    })

    document.getElementById('buyer-form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      this.handleBuyerSubmit(e)
    })

    document.getElementById('user-setup-form')?.addEventListener('submit', (e) => {
      e.preventDefault()
      this.handleUserSetup(e)
    })

    // Recherche
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchProducts(e.target.value)
    })

    document.getElementById('category-filter')?.addEventListener('change', (e) => {
      this.filterProducts(e.target.value)
    })
  }

  async loadUser() {
    this.currentUser = await this.userManager.getCurrentUser()
    if (!this.currentUser) {
      this.showView('setup')
      this.hideNavigation()
    } else {
      this.showNavigation()
      this.updateStats()
    }
  }

  // Masquer/Afficher la navigation
  hideNavigation() {
    const nav = document.querySelector('.main-nav')
    if (nav) nav.style.display = 'none'
  }

  showNavigation() {
    const nav = document.querySelector('.main-nav')
    if (nav) nav.style.display = 'flex'
  }

  // Vérifier si l'utilisateur est configuré
  requireUser() {
    if (!this.currentUser) {
      this.showNotification('Configuration utilisateur requise')
      this.showView('setup')
      return false
    }
    return true
  }

  // Navigation entre vues
  showView(viewName) {
    // Vérifier configuration utilisateur (sauf pour setup)
    if (viewName !== 'setup' && !this.requireUser()) {
      return
    }

    this.currentView = viewName

    // Masquer toutes les vues
    document.querySelectorAll('.view').forEach(view => {
      view.classList.add('hidden')
    })

    // Afficher la vue demandée
    document.getElementById(`${viewName}-view`)?.classList.remove('hidden')

    // Mise à jour navigation
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName)
    })

    // Actions spécifiques par vue
    switch (viewName) {
      case 'home':
        this.updateStats()
        break
      case 'products':
        this.loadProducts()
        break
      case 'seller':
        this.loadSellerProducts()
        break
      case 'buyer':
        this.loadBuyerSearches()
        break
    }
  }

  // Configuration utilisateur
  async handleUserSetup(e) {
    const formData = new FormData(e.target)
    const userData = {
      name: formData.get('name'),
      type: formData.get('type'), // vendeur, acheteur, both
      location: null
    }

    try {
      // Obtenir la localisation
      this.showNotification('Obtention de votre position...')
      userData.location = await this.locationManager.getLocation()
      this.userLocation = userData.location

      // Sauvegarder utilisateur
      this.currentUser = await this.userManager.saveUser(userData)

      this.showNotification(`Bienvenue ${userData.name} !`)
      this.showView('home')

    } catch (error) {
      this.showNotification('Erreur lors de la configuration')
      console.error('Setup error:', error)
    }
  }

  // Vendeur - Ajouter produit
  async handleSellerSubmit(e) {
    if (!this.currentUser) {
      this.showNotification('Configuration utilisateur requise')
      return
    }

    const formData = new FormData(e.target)
    const productData = {
      sellerId: this.currentUser.id,
      sellerName: this.currentUser.name,
      name: formData.get('name'),
      category: formData.get('category'),
      description: formData.get('description'),
      quantity: formData.get('quantity'),
      unit: formData.get('unit'),
      price: parseFloat(formData.get('price')),
      harvestDate: formData.get('harvestDate'),
      location: this.userLocation || this.currentUser.location
    }

    try {
      const product = await this.productManager.saveProduct(productData)

      // Notifier acheteurs intéressés
      await this.notificationManager.notifyBuyers(product, this.locationManager)

      this.showNotification('Produit ajouté et notifications envoyées !')
      e.target.reset()
      this.loadSellerProducts()

    } catch (error) {
      this.showNotification('Erreur lors de l\'ajout du produit')
      console.error('Product save error:', error)
    }
  }

  // Acheteur - Sauvegarder recherche
  async handleBuyerSubmit(e) {
    if (!this.currentUser) {
      this.showNotification('Configuration utilisateur requise')
      return
    }

    const formData = new FormData(e.target)
    const searchData = {
      userId: this.currentUser.id,
      category: formData.get('category'),
      keywords: formData.get('keywords'),
      radius: parseInt(formData.get('radius')),
      maxPrice: parseFloat(formData.get('maxPrice')) || null
    }

    try {
      await this.userManager.saveBuyerSearch(searchData)
      this.showNotification('Recherche sauvegardée ! Vous recevrez des notifications.')
      e.target.reset()
      this.loadBuyerSearches()

    } catch (error) {
      this.showNotification('Erreur lors de la sauvegarde')
      console.error('Search save error:', error)
    }
  }

  // Charger et afficher produits
  async loadProducts() {
    try {
      const products = await this.productManager.getProducts()
      const productsContainer = document.getElementById('products-list')

      if (!productsContainer) return

      if (products.length === 0) {
        productsContainer.innerHTML = '<p class="empty-state">Aucun produit disponible</p>'
        return
      }

      productsContainer.innerHTML = products
        .filter(p => p.status === 'disponible')
        .map(product => this.renderProductCard(product))
        .join('')

    } catch (error) {
      console.error('Erreur chargement produits:', error)
    }
  }

  // Charger produits du vendeur
  async loadSellerProducts() {
    if (!this.currentUser) return

    try {
      const allProducts = await this.productManager.getProducts()
      const myProducts = allProducts.filter(p => p.sellerId === this.currentUser.id)
      const container = document.getElementById('my-products-list')

      if (!container) return

      if (myProducts.length === 0) {
        container.innerHTML = '<p class="empty-state">Vous n\'avez pas encore ajouté de produits</p>'
        return
      }

      container.innerHTML = myProducts.map(product => `
        <div class="product-card seller-product">
          <h3>${product.name}</h3>
          <p><strong>Catégorie:</strong> ${product.category}</p>
          <p><strong>Quantité:</strong> ${product.quantity} ${product.unit}</p>
          <p><strong>Prix:</strong> ${product.price}€</p>
          <p><strong>Récolte:</strong> ${new Date(product.harvestDate).toLocaleDateString()}</p>
          <p><strong>Statut:</strong> ${product.status}</p>
          <div class="product-actions">
            <button onclick="app.updateProductStatus(${product.id}, 'vendu')" class="btn secondary">Marquer vendu</button>
            <button onclick="app.updateProductStatus(${product.id}, 'indisponible')" class="btn secondary">Retirer</button>
          </div>
        </div>
      `).join('')

    } catch (error) {
      console.error('Erreur chargement produits vendeur:', error)
    }
  }

  // Charger recherches de l'acheteur
  async loadBuyerSearches() {
    if (!this.currentUser) return

    try {
      const allSearches = await localforage.getItem('savedSearches') || []
      const mySearches = allSearches.filter(s => s.userId === this.currentUser.id)
      const container = document.getElementById('my-searches-list')

      if (!container) return

      if (mySearches.length === 0) {
        container.innerHTML = '<p class="empty-state">Aucune recherche sauvegardée</p>'
        return
      }

      container.innerHTML = mySearches.map(search => `
        <div class="search-card">
          <h3>${search.category === 'all' ? 'Toutes catégories' : search.category}</h3>
          <p><strong>Mots-clés:</strong> ${search.keywords || 'Aucun'}</p>
          <p><strong>Rayon:</strong> ${search.radius} km</p>
          <p><strong>Prix max:</strong> ${search.maxPrice ? search.maxPrice + '€' : 'Aucune limite'}</p>
          <p><strong>Créée le:</strong> ${new Date(search.createdAt).toLocaleDateString()}</p>
          <button onclick="app.deleteSearch(${search.id})" class="btn secondary">Supprimer</button>
        </div>
      `).join('')

    } catch (error) {
      console.error('Erreur chargement recherches:', error)
    }
  }

  // Mettre à jour les statistiques de l'accueil
  async updateStats() {
    try {
      const products = await this.productManager.getProducts()
      const users = await localforage.getItem('users') || []

      const availableProducts = products.filter(p => p.status === 'disponible')
      const sellers = [...new Set(products.map(p => p.sellerId))].length

      document.getElementById('products-count').textContent = availableProducts.length
      document.getElementById('sellers-count').textContent = sellers

    } catch (error) {
      console.error('Erreur mise à jour stats:', error)
    }
  }

  renderProductCard(product) {
    const distance = this.calculateDistanceToProduct(product)
    const distanceText = distance ? `à ${distance.toFixed(1)}km` : ''

    return `
      <div class="product-card">
        <div class="product-header">
          <h3>${product.name}</h3>
          <span class="product-category">${product.category}</span>
        </div>
        <p class="product-description">${product.description}</p>
        <div class="product-details">
          <p><strong>Quantité:</strong> ${product.quantity} ${product.unit}</p>
          <p><strong>Prix:</strong> ${product.price}€</p>
          <p><strong>Récolte prévue:</strong> ${new Date(product.harvestDate).toLocaleDateString()}</p>
          <p><strong>Vendeur:</strong> ${product.sellerName} ${distanceText}</p>
        </div>
        <div class="product-actions">
          <button onclick="app.contactSeller(${product.id})" class="btn primary">Contacter</button>
        </div>
      </div>
    `
  }

  calculateDistanceToProduct(product) {
    if (!product.location || !this.userLocation) return null
    return this.locationManager.calculateDistance(this.userLocation, product.location)
  }

  // Actions produits
  async updateProductStatus(productId, status) {
    const success = await this.productManager.updateProductStatus(productId, status)
    if (success) {
      this.showNotification('Produit mis à jour')
      this.loadSellerProducts()
      if (this.currentView === 'home') {
        this.updateStats()
      }
    } else {
      this.showNotification('Erreur mise à jour')
    }
  }

  async deleteSearch(searchId) {
    try {
      let searches = await localforage.getItem('savedSearches') || []
      searches = searches.filter(s => s.id !== searchId)
      await localforage.setItem('savedSearches', searches)
      this.showNotification('Recherche supprimée')
      this.loadBuyerSearches()
    } catch (error) {
      this.showNotification('Erreur suppression')
    }
  }

  contactSeller(productId) {
    // Ici tu peux implémenter le système de contact
    this.showNotification('Fonctionnalité de contact à implémenter')
    // Exemple : ouvrir modal avec infos contact du vendeur
  }

  // Recherche et filtres
  async searchProducts(query) {
    const products = await this.productManager.getProducts()
    const filtered = this.productManager.searchProducts(products, { search: query })

    const container = document.getElementById('products-list')
    if (container) {
      container.innerHTML = filtered
        .filter(p => p.status === 'disponible')
        .map(product => this.renderProductCard(product))
        .join('')
    }
  }

  async filterProducts(category) {
    const products = await this.productManager.getProducts()
    const filtered = this.productManager.searchProducts(products, { category })

    const container = document.getElementById('products-list')
    if (container) {
      container.innerHTML = filtered
        .filter(p => p.status === 'disponible')
        .map(product => this.renderProductCard(product))
        .join('')
    }
  }

  // PWA utilities
  async installApp() {
    if (!this.installPrompt) return

    try {
      this.installPrompt.prompt()
      const result = await this.installPrompt.userChoice

      if (result.outcome === 'accepted') {
        this.showNotification('Application installée !')
      }

      this.installPrompt = null
    } catch (error) {
      console.error('Erreur installation:', error)
    }
  }

  updateStatus() {
    const statusEl = document.getElementById('status')
    if (statusEl) {
      statusEl.textContent = this.isOnline ? 'En ligne' : 'Hors ligne'
    }
  }

  handleOnline() {
    this.isOnline = true
    this.updateStatus()
    this.showNotification('Connexion rétablie')
  }

  handleOffline() {
    this.isOnline = false
    this.updateStatus()
    this.showNotification('Mode hors ligne')
  }

  showNotification(message) {
    const notification = document.createElement('div')
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 1000;
      background: #10b981; color: white; padding: 1rem 2rem;
      border-radius: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideIn 0.3s ease;
    `
    notification.textContent = message
    document.body.appendChild(notification)
    setTimeout(() => notification.remove(), 4000)
  }
}

// Initialiser l'application
window.app = new MarketplacePWA()