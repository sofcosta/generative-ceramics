const FAVORITES_KEY = 'mandala_favorites';

// Save a new configuration to favorites
export function saveToFavorites(params) {
    const favorites = getFavorites();

    // Create a deep copy of current params and add a metadata ID/timestamp
    const favoriteItem = {
        id: 'fav_' + Date.now(),
        date: new Date().toLocaleDateString(),
        data: JSON.parse(JSON.stringify(params))
    };

    favorites.push(favoriteItem);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    return favoriteItem;
}

// Retrieve all favorites
export function getFavorites() {
    const data = localStorage.getItem(FAVORITES_KEY);
    return data ? JSON.parse(data) : [];
}

// Remove a configuration by ID
export function deleteFavorite(id) {
    let favorites = getFavorites();
    favorites = favorites.filter(item => item.id !== id);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

///--------------------------------------------///
