let placesDB = {};   // will be filled by fetch below

// Load data first, then initialize everything
fetch('/data/places.json')
  .then(res => res.json())
  .then(data => {
    placesDB = data;
    init();           // run your setup after data is ready
  });


function init() {
  let navSound = new Audio("/sounds/navigate2.mp3");

  // FOR COMPLETE NAME SUGGESION
  const searchBox = document.getElementById("searchBox");
  const dropdown = document.getElementById("dropdown");

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/\bdr\.?\b/g, "")  // remove "dr" or "dr."
      .replace(/\s+/g, " ")       // remove extra spaces
      .trim();
  }

  searchBox.addEventListener("input", function () {
    let input = normalize(this.value);

    dropdown.innerHTML = "";
    if (!input) return;

    let matches = Object.keys(placesDB).filter(key => {
      let keyText = normalize(key);
      let indoorText = normalize(placesDB[key].indoorName);

      return keyText.includes(input) || indoorText.includes(input);
    });

    matches.slice(0, 6).forEach(key => {
      let item = document.createElement("div");
      item.className = "dropdown-item";

      let name = placesDB[key].indoorName;

      // highlight match 
      let safeInput = this.value.trim();     // original input for highlight
      let regex = new RegExp(safeInput, "gi");

      item.innerHTML = name.replace(regex, match => `<b>${match}</b>`);

      item.addEventListener("click", () => {
        searchBox.value = name;
        dropdown.innerHTML = "";
        console.log(name);
      });

      dropdown.appendChild(item);

    });
  });

  // CLOSE DROPDOWN WHEN CLICK OUTSIDE
  document.addEventListener("click", (e) => {
    if (!searchBox.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.innerHTML = "";
    }
  });



  function findPlace(q) {
    q = q.toLowerCase().trim();

    let bestMatch = null;
    let bestScore = -1;

    for (let key in placesDB) {

      let indoor = placesDB[key].indoorName.toLowerCase();
      let score = 0;

      // Exact match (highest priority)
      if (indoor === q || key === q) score += 1000;

      // Starts with (very strong)
      if (indoor.startsWith(q) || key.startsWith(q)) score += 500;

      //  Word match 
      let words = indoor.split(" ");
      if (words.includes(q)) score += 300;

      // Substring match
      if (indoor.includes(q)) score += 100;
      if (key.includes(q)) score += 100;

      // Length penalty 
      score -= Math.abs(indoor.length - q.length);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = placesDB[key];
      }
    }

    console.log("Best match:", bestMatch, "Score:", bestScore);
    return bestMatch;
  }

  // MAP
  var map = L.map('map', { zoomControl: false }).setView([30.7649, 76.7868], 18);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);


  let currentLocation = null;
  let userMarker = null;
  let accuracyCircle = null;
  let watchId = null;
  let routeControl = null;
  let selectedPlace = null;
  let lastUpdate = 0;
  let followUser = true;  // FIX 1: moved outside success() so it persists across calls

  // FIX 1: register drag/zoom listeners once, not inside success() which runs every 2 seconds
  map.on('dragstart zoomstart', () => {
    followUser = false;
  });

  // CHECK SUPPORT
  if (!navigator.geolocation) {
    alert("Geolocation not supported by your browser");
  } else {

    watchId = navigator.geolocation.watchPosition(
      success,
      error,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  let lastRouteUpdate = 0; // FIX 4: separate throttle for route updates

  function success(pos) {

    let now = Date.now();

    // limit updates (every 2 seconds)
    if (now - lastUpdate < 2000) return;

    let lat = pos.coords.latitude;
    let lng = pos.coords.longitude;
    let accuracy = pos.coords.accuracy;

    let newLocation = L.latLng(lat, lng);

    // FIX 2: skip redraw if user hasn't moved more than 3 metres
    if (currentLocation && currentLocation.distanceTo(newLocation) < 3) return;

    lastUpdate = now;
    currentLocation = newLocation;

    console.log("Live Location:", lat, lng);

    // Save for other pages
    localStorage.setItem("currentLat", lat);
    localStorage.setItem("currentLng", lng);

    // FIX 3: update existing marker/circle position instead of remove+add every tick
    if (userMarker) {
      userMarker.setLatLng(currentLocation);
    } else {
      userMarker = L.marker(currentLocation).addTo(map);
    }

    if (accuracyCircle) {
      accuracyCircle.setLatLng(currentLocation);
      accuracyCircle.setRadius(accuracy);
    } else {
      accuracyCircle = L.circle(currentLocation, { radius: accuracy }).addTo(map);
    }

    // Follow user
    if (followUser) {
      map.setView(currentLocation, 18);
    }

    // FIX 4: only update route every 10 seconds, not every 2 seconds
    if (routeControl && selectedPlace && now - lastRouteUpdate > 10000) {
      lastRouteUpdate = now;

      let dest = L.latLng(
        selectedPlace.entrance[0],
        selectedPlace.entrance[1]
      );

      routeControl.setWaypoints([
        currentLocation,
        dest
      ]);
    }
  }

  function error(err) {
    console.error("Location error:", err);

    alert("Location access denied or unavailable");

    // fallback location
    currentLocation = L.latLng(30.7649, 76.7868);

    userMarker = L.marker(currentLocation).addTo(map);
    map.setView(currentLocation, 18);
  }


  document.getElementById("searchBox").addEventListener("change", function () {

    if (!currentLocation) {
      alert("Waiting for GPS... Try again in 2 seconds");
      return;
    }

    console.log("Routing from:", currentLocation);
    navSound.volume = 0.9;
    navSound.play().catch(() => { });       // prevent autoplay error

    let place = findPlace(this.value);

    if (!place) {
      alert("Not found");
      return;
    }

    selectedPlace = place;

    let dest = L.latLng(place.entrance[0], place.entrance[1]);

    console.log("Destination:", dest);
    console.log("selected place:", selectedPlace);

    if (routeControl) map.removeControl(routeControl);

    routeControl = L.Routing.control({
      waypoints: [currentLocation, dest],

      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1'
      }),

      routeWhileDragging: false,
      draggableWaypoints: false,
      addWaypoints: false,

      show: false, // cleaner UI

      createMarker: function () {
        return null;
      }

    }).addTo(map);

    // remove old markers
    if (window.startMarker) map.removeLayer(startMarker);
    if (window.endMarker) map.removeLayer(endMarker);


    // add destination marker
    endMarker = L.marker(dest).addTo(map)
      .bindPopup("Destination")
      .openPopup();

    document.getElementById("enterBtn").style.display = "block";

  });


  document.getElementById("enterBtn").onclick = function () {

    if (!selectedPlace) {
      alert("Search first");
      return;
    }

    let room = selectedPlace.indoorName;

    // Save (backup method)
    localStorage.setItem("selectedRoom", room);

    // Pass via URL
    let encodedRoom = encodeURIComponent(room);

    // Use the building field, default to in3.html if not set
    let targetBuilding = selectedPlace.building || "in3.html";

    window.location.href = `${targetBuilding}?room=${encodedRoom}`;
  };
};