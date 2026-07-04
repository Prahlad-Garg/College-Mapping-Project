let floorGeoJSON = {};
let rawNodes     = {};
let rawRoutes    = {};

// Load all 3 data files in parallel, then initialize
Promise.all([
    fetch('/data/floors.json').then(r => r.json()),
    fetch('/data/nodes.json').then(r => r.json()),
    fetch('/data/routes.json').then(r => r.json())
])
.then(([floors, nodes, routes]) => {
    floorGeoJSON = floors;
    rawNodes     = nodes;
    rawRoutes    = routes;
    init();
})
.catch(err => {
    console.error("Failed to load data files:", err);
    alert("Could not load map data. Check that floors.json, nodes.json and routes.json exist in /data/");
});


function init() {

    let room_url = "";
    let lastDestination = null;
    let lastDestinationFloor = 0;

    // ROOM IMAGES
    var roomImages = {
        "dr sandeep kaur":   "images/image1.jpeg",
        "dr balwinder singh":"images/balwinder.jpeg",
        "dr jaimala gambhir":"images/jaimala.jpeg",
        "cl13":              "images/cl13.jpeg",
        "cse office":        "images/cse_office.jpeg",
        "starting":          "images/image2.jpeg"
    };

    function getPopupContent(name) {
        name = name.toLowerCase().trim();
        let img = roomImages[name];
        return `
            <div style="text-align:center; width:160px; font-family:Segoe UI;">
                <b style="font-size:14px; color:#1e293b;">${name.toUpperCase()}</b>
                <br><br>
                ${img
                    ? `<img src="${img}" style="width:150px; border-radius:10px; box-shadow:0 4px 12px rgba(0,0,0,0.3);">`
                    : `<div style="color:gray;">No image available</div>`
                }
            </div>
        `;
    }

    function getRoomFromURL() {
        let params = new URLSearchParams(window.location.search);
        return params.get("room");
    }

    room_url = getRoomFromURL();
    console.log("Room from URL:", room_url);

    // MAP SETUP
    var map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        inertia: false
    });

    // TILT ANIMATION (only runs when mouse is moving)
    const mapElement = document.getElementById("map");
    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let tiltActive = false;

    mapElement.addEventListener("mousemove", (e) => {
        let x = e.clientX / window.innerWidth;
        let y = e.clientY / window.innerHeight;

        targetX = (0.5 - y) * 10;
        targetY = (x - 0.5) * 12;

        if (!tiltActive) {
            tiltActive = true;
            animateTilt();
        }
    });

    const mapWrapper = document.querySelector(".map-wrapper");

    function animateTilt() {
        currentX += (targetX - currentX) * 0.1;
        currentY += (targetY - currentY) * 0.1;

        mapWrapper.style.transform = `
            perspective(900px)
            rotateX(${6 + currentX}deg)
            rotateY(${currentY}deg)
        `;

        if (Math.abs(targetX - currentX) > 0.01 || Math.abs(targetY - currentY) > 0.01) {
            requestAnimationFrame(animateTilt);
        } else {
            tiltActive = false;
        }
    }

    // BUILDING
    var buildingGeoJSON = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [76.78576582482845, 30.767573709341335],
                    [76.78596574349359, 30.767296213666597],
                    [76.786081603061,   30.767357957305023],
                    [76.78588176739316, 30.767632294187052],
                    [76.78576582482845, 30.767573709341335]
                ]]
            }
        }]
    };

    // ROTATION HELPERS
    function rotateGeoJSON(geojson, angle, center) {
        let rad = angle * Math.PI / 180;

        function rotateCoord(coord) {
            let x = coord[0] - center[0];
            let y = coord[1] - center[1];
            let newX = x * Math.cos(rad) - y * Math.sin(rad);
            let newY = x * Math.sin(rad) + y * Math.cos(rad);
            return [newX + center[0], newY + center[1]];
        }

        return {
            ...geojson,
            features: geojson.features.map(f => ({
                ...f,
                geometry: {
                    ...f.geometry,
                    coordinates:
                        f.geometry.type === "Polygon"
                            ? f.geometry.coordinates.map(r => r.map(rotateCoord))
                        : f.geometry.type === "LineString"
                            ? f.geometry.coordinates.map(rotateCoord)
                        : f.geometry.type === "Point"
                            ? rotateCoord(f.geometry.coordinates)
                        : f.geometry.coordinates
                }
            }))
        };
    }

    function rotatePoint(coord, angle, center) {
        let rad = angle * Math.PI / 180;
        let x = coord[0] - center[0];
        let y = coord[1] - center[1];
        let newX = x * Math.cos(rad) - y * Math.sin(rad);
        let newY = x * Math.sin(rad) + y * Math.cos(rad);
        return [newX + center[0], newY + center[1]];
    }

    function rotateNodes(nodes, angle, center) {
        let rotated = {};
        for (let key in nodes) {
            rotated[key] = rotatePoint(nodes[key], angle, center);
        }
        return rotated;
    }

    // BUILD BUILDING LAYER & GET CENTER
    var tempLayer = L.geoJSON(buildingGeoJSON);
    var center    = tempLayer.getBounds().getCenter();
    var centerCoords = [center.lng, center.lat];

    var rotatedBuilding = rotateGeoJSON(buildingGeoJSON, 56, centerCoords);

    var buildingLayer = L.geoJSON(rotatedBuilding, {
        style: {
            color: "#475569",
            weight: 8,
            fillColor: "#1e293b",
            fillOpacity: 0.9
        }
    }).addTo(map);

    map.fitBounds(buildingLayer.getBounds(), { padding: [20, 20] });
    map.setMinZoom(18);
    map.setMaxZoom(23);

    // PRE-ROTATE ALL FLOORS ONCE (cached)
    var rotatedFloors = {};
    for (let floor in floorGeoJSON) {
        rotatedFloors[floor] = rotateGeoJSON(floorGeoJSON[floor], 56, centerCoords);
    }

    // BUILD ROTATED NODES FROM nodes.json
    var rotatedNodes  = rotateNodes(rawNodes.ground,  56, centerCoords);
    var rotatedNodes1 = rotateNodes(rawNodes.floor1,  56, centerCoords);
    var rotatedNodes2 = rotateNodes(rawNodes.floor2,  56, centerCoords);

    // BUILD ROUTE COORDINATE ARRAYS FROM routes.json key names
    function buildRoutes(routeMap, nodeMap) {
        let built = {};
        for (let name in routeMap) {
            built[name] = routeMap[name].map(key => nodeMap[key]);
        }
        return built;
    }

    var routes       = buildRoutes(rawRoutes.ground,  rotatedNodes);
    var routesFloor1 = buildRoutes(rawRoutes.floor1,  rotatedNodes1);
    var routesFloor2 = buildRoutes(rawRoutes.floor2,  rotatedNodes2);

    // FLOOR STATE
    var currentLayer   = null;
    var markerLayer    = L.layerGroup().addTo(map);
    var currentFloor   = 0;
    var routeLayer     = null;
    var animationInterval = null;
    var markerAnimations  = [];
    var allFeatureLayers  = [];

    // LOAD FLOOR (with optional onReady callback)
    function loadFloor(floor, onReady) {
        currentFloor = floor;
        allFeatureLayers = [];

        if (currentLayer) map.removeLayer(currentLayer);

        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }

        if (animationInterval) clearInterval(animationInterval);

        markerLayer.clearLayers();

        currentLayer = L.geoJSON(rotatedFloors[floor], {

            style: function(feature) {
                if (feature.geometry.type === "LineString") {
                    return { color: "#475569", weight: 8, opacity: 0.9 };
                }
            },

            pointToLayer: function(feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: 6,
                    color: "white",
                    fillColor: "red",
                    fillOpacity: 0,
                    weight: 0
                });
            },

            onEachFeature: function(feature, layer) {
                allFeatureLayers.push({ feature: feature, layer: layer });

                if (feature.properties && feature.properties.name) {
                    let name = feature.properties.name.toLowerCase();

                    layer.bindPopup(getPopupContent(name));

                    if (name === "starting" || name === "stairs") {
                        layer.bindTooltip(feature.properties.name, {
                            permanent: true,
                            direction: "top",
                            className: "important-label"
                        });
                    } else {
                        layer.bindTooltip(feature.properties.name);
                    }
                }
            }

        }).addTo(map);

        if (onReady) onReady();
    }

    // LOAD DEFAULT FLOOR
    loadFloor(0, null);

    // FIND BEST MATCH within a features array
    function findBestMatch(input, features) {
        const ignoreWords = ["dr", "mr", "mrs", "ms"];
        input = input.toLowerCase().trim();
        let inputWords = input.split(" ").filter(w => !ignoreWords.includes(w));

        let bestMatch = null;
        let bestScore = 0;

        features.forEach(f => {
            if (!f.properties || !f.properties.name) return;

            let name      = f.properties.name.toLowerCase();
            let nameWords = name.split(" ").filter(w => !ignoreWords.includes(w));
            let score     = 0;

            inputWords.forEach(word => {
                if (nameWords.includes(word)) score += 2;
                else if (name.includes(word))  score += 1;
            });

            if (name === input) score += 5;

            if (score > bestScore) {
                bestScore = score;
                bestMatch = f;
            }
        });

        return bestMatch;
    }

    // FIND FEATURE ACROSS ALL FLOORS
    function findFeatureAcrossFloors(input) {
        console.log("Searching for:", input);
        input = input.toLowerCase().trim();

        for (let floor in floorGeoJSON) {
            let features = floorGeoJSON[floor].features;

            // Exact match first
            for (let f of features) {
                let name = f.properties?.name?.toLowerCase().trim();
                if (name === input) {
                    return { feature: f, floor: parseInt(floor) };
                }
            }

            // Fallback to fuzzy
            let match = findBestMatch(input, features);
            if (match) {
                return { feature: match, floor: parseInt(floor) };
            }
        }

        return null;
    }

    // ROUTE HELPERS
    function fixLatLng(path) {
        return path.map(p => [p[1], p[0]]);
    }

    function normalizeName(name) {
        return name.toLowerCase().trim();
    }

    function starting_marker(latlng) {
        L.circleMarker(latlng, {
            radius: 5,
            color: "#22C55E",
            fillColor: "white",
            fillOpacity: 1
        })
        .addTo(markerLayer)
        .bindPopup(getPopupContent("starting"))
        .openPopup();
    }

    function addPulseMarker(latlng, name) {
        let marker = L.circleMarker(latlng, {
            radius: 5,
            color: "#EF4444",
            fillColor: "white",
            fillOpacity: 1
        })
        .addTo(markerLayer)
        .bindPopup(getPopupContent(name))
        .openPopup();

        let growing = true;

        let interval = setInterval(() => {
            let r = marker.getRadius();
            if (r > 9) growing = false;
            if (r < 6) growing = true;
            marker.setRadius(growing ? r + 1 : r - 1);
        }, 100);

        markerAnimations.push(interval);
    }

    function animateRoute(pathCoords, onComplete) {
        markerAnimations.forEach(i => clearInterval(i));
        markerAnimations = [];

        let line = L.polyline([], {
            color: "#4ade80",
            weight: 8,
            opacity: 1,
            className: "glow-line",
            lineCap: "round",
            lineJoin: "round"
        }).addTo(map);

        let progress = 0;

        function animate() {
            progress += 0.01;
            let index = Math.floor(progress * pathCoords.length);
            line.setLatLngs(pathCoords.slice(0, index));

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                if (onComplete) onComplete();
            }
        }

        animate();
        return line;
    }

    function showRoute(placeName, onComplete) {
        placeName = normalizeName(placeName);

        if (routeLayer) map.removeLayer(routeLayer);

        let path = null;

        if      (currentFloor === 0) path = routes[placeName];
        else if (currentFloor === 1) path = routesFloor1[placeName];
        else if (currentFloor === 2) path = routesFloor2[placeName];

        if (!path) {
            alert("No route found for " + placeName);
            return;
        }

        let fixedPath = fixLatLng(path);

        starting_marker(fixedPath[0]);
        addPulseMarker(fixedPath[fixedPath.length - 1], placeName);

        routeLayer = animateRoute(fixedPath, onComplete);
    }

    function showOnlyDestination(name) {
        allFeatureLayers.forEach(obj => {
            let fName = obj.feature.properties?.name?.toLowerCase();
            if (!fName) return;

            if (fName === name || fName === "starting") {
                obj.layer.openTooltip();
            } else {
                obj.layer.closeTooltip();
            }
        });
    }

    function drawRouteInstant(placeName) {
        placeName = normalizeName(placeName);
        let isTransitioning = false;

        if (routeLayer) map.removeLayer(routeLayer);

        let path = null;

        if (currentFloor === lastDestinationFloor) {
            if      (currentFloor === 0) path = routes[placeName];
            else if (currentFloor === 1) path = routesFloor1[placeName];
            else if (currentFloor === 2) path = routesFloor2[placeName];
        } else {
            if (currentFloor === 0) {
                path = routes["stairs"];
                isTransitioning = true;
            } else if (currentFloor === 1) {
                path = routesFloor1[placeName];
            }
        }

        if (!path) {
            console.log("No route for this floor");
            return;
        }

        let fixedPath = fixLatLng(path);

        markerLayer.clearLayers();
        starting_marker(fixedPath[0]);

        if (isTransitioning) {
            addPulseMarker(fixedPath[fixedPath.length - 1], "stairs");
        } else {
            addPulseMarker(fixedPath[fixedPath.length - 1], placeName);
        }

        routeLayer = L.polyline(fixedPath, { color: "#4ade80", weight: 8 }).addTo(map);
    }

    // FLOOR TRANSITION ANIMATION
    function animateFloorTransition(nextFloor = 1) {
        return new Promise((resolve) => {

            let audio = new Audio("/sounds/elevator2.mp3");
            audio.volume = 0.9;
            audio.play().catch(() => {});

            if (navigator.vibrate) navigator.vibrate([100, 50, 150]);

            let overlay = document.createElement("div");
            overlay.style.cssText = `
                position:absolute; top:0; left:0;
                width:100%; height:100%;
                background:linear-gradient(135deg,#020617,#0f172a);
                display:flex; align-items:center; justify-content:center;
                flex-direction:column; color:white;
                font-size:22px; z-index:2000; overflow:hidden;
            `;

            overlay.innerHTML = `
                <div style="text-align:center">
                    <div id="floorText" style="
                        font-size:32px; font-weight:bold;
                        transform:translateY(40px); opacity:0;
                        transition:all 0.5s ease;">
                        Floor ${currentFloor} → ${nextFloor}
                    </div>
                    <div id="arrow" style="
                        font-size:40px; margin-top:15px;
                        transform:translateY(40px); opacity:0;
                        transition:all 0.5s ease 0.2s;">
                        ⬆️
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.querySelector("#floorText").style.transform = "translateY(0)";
                overlay.querySelector("#floorText").style.opacity   = "1";
                overlay.querySelector("#arrow").style.transform     = "translateY(0)";
                overlay.querySelector("#arrow").style.opacity       = "1";
            });

            setTimeout(() => { resolve(); },                             700);
            setTimeout(() => { overlay.style.opacity = "0"; overlay.style.transform = "scale(0.95)"; }, 1200);
            setTimeout(() => { overlay.remove(); },                      1300);
        });
    }

    // FLOOR BUTTONS
    window.nextFloor = function() {
        if (currentFloor >= 2) return;
        let targetFloor = currentFloor + 1;
        currentFloor = targetFloor;

        loadFloor(targetFloor, function() {
            markerAnimations.forEach(i => clearInterval(i));
            markerAnimations = [];

            if (lastDestination) {
                if (targetFloor !== lastDestinationFloor) {
                    drawRouteInstant("stairs");
                    showOnlyDestination("stairs");
                } else {
                    drawRouteInstant(lastDestination);
                    showOnlyDestination(lastDestination);
                }
            }
        });
    };

    window.prevFloor = function() {
        if (currentFloor <= 0) return;
        let targetFloor = currentFloor - 1;
        currentFloor = targetFloor;

        loadFloor(targetFloor, function() {
            markerAnimations.forEach(i => clearInterval(i));
            markerAnimations = [];

            if (lastDestination) {
                drawRouteInstant(lastDestination);
                showOnlyDestination(lastDestination);
            }
        });
    };

    // MAIN NAVIGATION
    async function navigateSmart(input) {
        let result = findFeatureAcrossFloors(input);

        if (!result) {
            alert("Location not found");
            return;
        }

        let name        = result.feature.properties.name.toLowerCase();
        let targetFloor = result.floor;
        lastDestination      = name;
        lastDestinationFloor = targetFloor;

        // GROUND FLOOR
        if (targetFloor === 0) {
            loadFloor(0, async function() {
                await showRoute(name);
                showOnlyDestination(name);
            });
        }

        // FIRST FLOOR
        else if (targetFloor === 1) {
            loadFloor(0, async function() {
                await showRoute("stairs");
                await new Promise(r => setTimeout(r, 2500));
                await animateFloorTransition(1);
                loadFloor(1, async function() {
                    await showRoute(name);
                    showOnlyDestination(name);
                });
            });
        }

        // SECOND FLOOR
        else if (targetFloor === 2) {
            loadFloor(0, async function() {
                await showRoute("stairs");
                await new Promise(r => setTimeout(r, 2500));
                await animateFloorTransition(2);
                loadFloor(2, async function() {
                    await showRoute(name);
                    showOnlyDestination(name);
                });
            });
        }
    }

    // START
    navigateSmart(room_url);
    console.log("Navigating to:", room_url);
}