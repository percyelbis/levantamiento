// ===== Global Variables =====
let map;
let polygonLayer = null;
let gridLayer = null;
let scaleControl = null;
let northArrowControl = null;
let baseLayers = {};

let pointsData = [];
let polygonCoordinates = [];
let currentMetrics = {
    area: 0,
    areaHa: 0,
    perimeter: 0,
    pointCount: 0,
    segments: []
};

// ===== Initialize Application =====
document.addEventListener('DOMContentLoaded', function () {
    initializeMap();
    setupEventListeners();
    generateYouTubeQR();
});

// ===== Map Initialization =====
function initializeMap() {
    // Canvas renderer ensures max rendering speed with many points/lines
    map = L.map('map', {
        preferCanvas: true,
        zoomSnap: 0.25,
        wheelDebounceTime: 40
    }).setView([-12.0464, -77.0428], 6);

    // 1. Esri World Imagery (CORS-friendly for instant PDF export)
    const esriSatellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
            attribution: '© Esri, Maxar, Earthstar Geographics',
            maxZoom: 19,
            crossOrigin: 'anonymous'
        }
    );

    // 2. Google Satellite (Optional viewing layer)
    const googleSatellite = L.tileLayer(
        'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        {
            attribution: '© Google',
            maxZoom: 22,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
        }
    );

    // 3. OpenStreetMap
    const osm = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            crossOrigin: 'anonymous'
        }
    );

    // Esri as default because it permits CORS export in PDF
    esriSatellite.addTo(map);

    baseLayers = {
        'Satélite (Esri)': esriSatellite,
        'Satélite (Google)': googleSatellite,
        'Calles (OSM)': osm
    };

    // Layer control
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    // Scale bar control (added once)
    scaleControl = L.control.scale({
        imperial: false,
        metric: true,
        maxWidth: 150,
        position: 'bottomleft'
    }).addTo(map);

    // North arrow control (added once)
    addNorthArrowControl();
}

// ===== North Arrow Control =====
function addNorthArrowControl() {
    if (northArrowControl) return;

    const NorthArrow = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            container.style.cursor = 'default';
            container.innerHTML = `
                <div style="background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px); padding: 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
                    <svg width="34" height="34" viewBox="0 0 40 40">
                        <polygon points="20,4 26,20 20,16 14,20" fill="#ef4444" stroke="#ffffff" stroke-width="1"/>
                        <polygon points="20,36 26,20 20,24 14,20" fill="#94a3b8" stroke="#ffffff" stroke-width="1"/>
                        <circle cx="20" cy="20" r="2.5" fill="#ffffff" />
                        <text x="20" y="38" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff" font-family="Inter, sans-serif">N</text>
                    </svg>
                </div>
            `;
            return container;
        }
    });

    northArrowControl = new NorthArrow();
    map.addControl(northArrowControl);
}

// ===== Event Listeners =====
function setupEventListeners() {
    const csvFileInput = document.getElementById('csvFile');
    csvFileInput.addEventListener('change', handleFileUpload);

    // Drag and Drop support for fast UX
    const uploadCard = document.querySelector('.upload-card');
    if (uploadCard) {
        ['dragenter', 'dragover'].forEach(eventName => {
            uploadCard.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
                uploadCard.classList.add('drag-active');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadCard.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
                uploadCard.classList.remove('drag-active');
            }, false);
        });

        uploadCard.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                csvFileInput.files = files;
                handleFileUpload({ target: { files: files } });
            }
        });
    }

    // Re-draw when EPSG code changes if data already exists
    const epsgInput = document.getElementById('epsgCode');
    epsgInput.addEventListener('change', () => {
        if (pointsData.length >= 3) {
            drawPolygon();
            calculateMetrics();
        }
    });

    document.getElementById('exportPDF').addEventListener('click', exportToPDF);
    document.getElementById('exportKML').addEventListener('click', exportToKML);
    document.getElementById('exportGeoJSON').addEventListener('click', exportToGeoJSON);
    document.getElementById('exportSHP').addEventListener('click', exportToSHP);
    document.getElementById('exportGPKG').addEventListener('click', exportToGPKG);
}

// ===== File Upload Handler =====
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const fileInfo = document.getElementById('fileInfo');
    fileInfo.textContent = `Cargando: ${file.name}...`;
    fileInfo.style.color = '#cbd5e1';

    showLoading(true);

    Papa.parse(file, {
        skipEmptyLines: 'greedy',
        complete: function (results) {
            processCSVData(results.data);
            fileInfo.textContent = `✓ Archivo cargado: ${file.name} (${pointsData.length} puntos procesados)`;
            fileInfo.style.color = '#10b981';
            showLoading(false);
        },
        error: function (error) {
            fileInfo.textContent = `✗ Error: ${error.message}`;
            fileInfo.style.color = '#ef4444';
            showLoading(false);
        }
    });
}

// ===== Ensure Projection in Proj4 =====
function getOrDefineProjection(code) {
    const epsgStr = String(code).trim().toUpperCase().replace('EPSG:', '');
    const projName = `EPSG:${epsgStr}`;

    if (proj4.defs(projName)) {
        return projName;
    }

    const epsgNum = parseInt(epsgStr, 10);

    // WGS 84 / UTM Zone 1N to 60N (32601 - 32660)
    if (epsgNum >= 32601 && epsgNum <= 32660) {
        const zone = epsgNum - 32600;
        proj4.defs(projName, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
        return projName;
    }

    // WGS 84 / UTM Zone 1S to 60S (32701 - 32760)
    if (epsgNum >= 32701 && epsgNum <= 32760) {
        const zone = epsgNum - 32700;
        proj4.defs(projName, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
        return projName;
    }

    // PSAD56 UTM Zones common in South America (17S: 24877, 18S: 24878, 19S: 24879)
    if (epsgNum === 24877) {
        proj4.defs(projName, '+proj=utm +zone=17 +south +ellps=intl +towgs84=-279,175,-379,0,0,0,0 +units=m +no_defs');
        return projName;
    }
    if (epsgNum === 24878) {
        proj4.defs(projName, '+proj=utm +zone=18 +south +ellps=intl +towgs84=-279,175,-379,0,0,0,0 +units=m +no_defs');
        return projName;
    }
    if (epsgNum === 24879) {
        proj4.defs(projName, '+proj=utm +zone=19 +south +ellps=intl +towgs84=-279,175,-379,0,0,0,0 +units=m +no_defs');
        return projName;
    }

    // Fallback: Default to UTM Zone 18S
    proj4.defs(projName, '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs');
    return projName;
}

// ===== Process CSV Data =====
function processCSVData(data) {
    pointsData = [];
    polygonCoordinates = [];

    if (!data || data.length === 0) return;

    data.forEach((row, index) => {
        if (!row || row.length < 3) return;

        // Header detection (e.g., "punto,este,norte..." or non-numeric coordinates)
        const col1Str = String(row[1]).trim().toLowerCase();
        const col2Str = String(row[2]).trim().toLowerCase();
        if (col1Str.includes('este') || col1Str.includes('x') || col2Str.includes('norte') || col2Str.includes('y')) {
            return; // Skip header
        }

        const este = parseFloat(row[1]);
        const norte = parseFloat(row[2]);

        // If coordinates aren't numbers, skip
        if (isNaN(este) || isNaN(norte)) return;

        // Support both numeric and alphanumeric vertex names ("1", "V-01", "A", etc.)
        const rawNumero = row[0] !== undefined && row[0] !== null ? String(row[0]).trim() : '';
        const numero = rawNumero || String(index + 1);
        const altura = row[3] !== undefined && row[3] !== '' ? parseFloat(row[3]) : 0;
        const descripcion = row[4] ? String(row[4]).trim() : '';

        pointsData.push({
            numero: numero,
            este: este,
            norte: norte,
            altura: isNaN(altura) ? 0 : altura,
            descripcion: descripcion
        });
    });

    if (pointsData.length >= 3) {
        drawPolygon();
        calculateMetrics();
        showResults();
    } else {
        alert('Se requieren al menos 3 vértices válidos con coordenadas Este y Norte.');
    }
}

// ===== Draw Polygon on Map =====
function drawPolygon() {
    // 1. Reset map bounds constraint from previous files
    map.setMaxBounds(null);

    // 2. Clear existing polygon layers
    if (polygonLayer) {
        map.removeLayer(polygonLayer);
        polygonLayer = null;
    }

    // 3. Clear existing grid
    if (gridLayer) {
        map.removeLayer(gridLayer);
        gridLayer = null;
    }

    // 4. Resolve Projection
    const epsgCode = document.getElementById('epsgCode').value || '32718';
    const utmProj = getOrDefineProjection(epsgCode);
    const wgs84Proj = 'EPSG:4326';

    // 5. Convert UTM coordinates to [lat, lng] in one fast pass
    polygonCoordinates = pointsData.map(point => {
        const [lng, lat] = proj4(utmProj, wgs84Proj, [point.este, point.norte]);
        return [lat, lng];
    });

    // 6. Create feature group for rapid batch operations
    polygonLayer = L.featureGroup();

    // 7. Create main polygon
    const polygon = L.polygon(polygonCoordinates, {
        color: '#6366f1',
        fillColor: '#818cf8',
        fillOpacity: 0.25,
        weight: 3
    }).addTo(polygonLayer);

    // 8. Add vertex markers & labels
    polygonCoordinates.forEach((latLng, idx) => {
        const point = pointsData[idx];

        // Vertex Circle
        const marker = L.circleMarker(latLng, {
            radius: 5,
            fillColor: '#ec4899',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.95
        });

        marker.bindPopup(`
            <div style="font-family: Inter, sans-serif; font-size: 12px; line-height: 1.5;">
                <strong style="color: #6366f1; font-size: 13px;">Vértice: ${point.numero}</strong><br>
                <b>Este:</b> ${point.este.toFixed(3)} m<br>
                <b>Norte:</b> ${point.norte.toFixed(3)} m<br>
                <b>Cota:</b> ${point.altura.toFixed(3)} m<br>
                ${point.descripcion ? `<b>Desc:</b> ${point.descripcion}` : ''}
            </div>
        `);
        marker.addTo(polygonLayer);

        // Vertex text pill label
        const label = L.marker(latLng, {
            icon: L.divIcon({
                className: 'point-label',
                html: `<div style="background: rgba(15, 23, 42, 0.85); color: #f8fafc; border: 1px solid #ec4899; padding: 1px 5px; border-radius: 4px; font-size: 10px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${point.numero}</div>`,
                iconSize: [24, 18],
                iconAnchor: [12, 22]
            }),
            interactive: false
        });
        label.addTo(polygonLayer);
    });

    // 9. Add layer to map
    polygonLayer.addTo(map);

    // 10. Fit view smoothly to the polygon bounds
    const bounds = polygon.getBounds();
    map.fitBounds(bounds, {
        padding: [45, 45],
        maxZoom: 18,
        animate: true
    });

    // 11. Add coordinates grid around polygon
    addOptimizedGrid(bounds);
}

// ===== Fast Coordinate Grid =====
function addOptimizedGrid(bounds) {
    if (gridLayer) {
        map.removeLayer(gridLayer);
    }
    gridLayer = L.layerGroup();

    const minLat = bounds.getSouth();
    const maxLat = bounds.getNorth();
    const minLng = bounds.getWest();
    const maxLng = bounds.getEast();

    const latDelta = maxLat - minLat;
    const lngDelta = maxLng - minLng;

    // Fast step estimation for 4-6 divisions
    const stepLat = latDelta / 5;
    const stepLng = lngDelta / 5;

    // Draw subtle latitude grid lines
    for (let i = 1; i < 5; i++) {
        const lat = minLat + (stepLat * i);
        L.polyline([[lat, minLng - lngDelta * 0.1], [lat, maxLng + lngDelta * 0.1]], {
            color: '#94a3b8',
            weight: 1,
            opacity: 0.25,
            dashArray: '4, 4',
            interactive: false
        }).addTo(gridLayer);
    }

    // Draw subtle longitude grid lines
    for (let i = 1; i < 5; i++) {
        const lng = minLng + (stepLng * i);
        L.polyline([[minLat - latDelta * 0.1, lng], [maxLat + latDelta * 0.1, lng]], {
            color: '#94a3b8',
            weight: 1,
            opacity: 0.25,
            dashArray: '4, 4',
            interactive: false
        }).addTo(gridLayer);
    }

    gridLayer.addTo(map);
}

// ===== Calculate Distance =====
function calculateDistance(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

// ===== Calculate Metrics with High Precision =====
function calculateMetrics() {
    const n = pointsData.length;
    if (n < 3) return;

    // Shift coordinates by (x0, y0) to eliminate catastrophic floating-point cancellation
    const x0 = pointsData[0].este;
    const y0 = pointsData[0].norte;

    let areaSum = 0;
    let perimeter = 0;
    const segments = [];

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p1 = pointsData[i];
        const p2 = pointsData[j];

        // Shifted coordinates for Gauss Shoelace
        const xi = p1.este - x0;
        const yi = p1.norte - y0;
        const xj = p2.este - x0;
        const yj = p2.norte - y0;

        areaSum += (xi * yj) - (xj * yi);

        // Segment calculations
        const distance = calculateDistance(p1.este, p1.norte, p2.este, p2.norte);
        perimeter += distance;

        segments.push({
            index: i + 1,
            from: p1.numero,
            to: p2.numero,
            distance: distance,
            deltaEste: p2.este - p1.este,
            deltaNorte: p2.norte - p1.norte,
            deltaAltura: p2.altura - p1.altura
        });
    }

    const area = Math.abs(areaSum) / 2;
    const areaHa = area / 10000;

    currentMetrics = {
        area: area,
        areaHa: areaHa,
        perimeter: perimeter,
        pointCount: n,
        segments: segments
    };

    // Update UI Cards
    document.getElementById('areaM2').textContent = `${area.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
    document.getElementById('areaHa').textContent = `${areaHa.toLocaleString('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} Ha`;
    document.getElementById('perimeter').textContent = `${perimeter.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
    document.getElementById('pointCount').textContent = `${n} puntos`;

    // Populate technical tables
    populateVerticesTable();
    populateDistancesTable();
}

// ===== Populate Vertices Table =====
function populateVerticesTable() {
    const tbody = document.querySelector('#verticesTable tbody');
    if (!tbody) return;

    tbody.innerHTML = pointsData.map(point => `
        <tr>
            <td>${point.numero}</td>
            <td>${point.este.toFixed(3)}</td>
            <td>${point.norte.toFixed(3)}</td>
            <td>${point.altura.toFixed(3)}</td>
            <td>${point.descripcion || '-'}</td>
        </tr>
    `).join('');
}

// ===== Populate Distances Table =====
function populateDistancesTable() {
    const tbody = document.querySelector('#distancesTable tbody');
    if (!tbody) return;

    tbody.innerHTML = currentMetrics.segments.map(s => `
        <tr>
            <td>${s.index}</td>
            <td>${s.from}</td>
            <td>${s.to}</td>
            <td>${s.distance.toFixed(3)}</td>
            <td>${s.deltaEste.toFixed(3)}</td>
            <td>${s.deltaNorte.toFixed(3)}</td>
            <td>${s.deltaAltura.toFixed(3)}</td>
        </tr>
    `).join('');
}

// ===== Show Results Section =====
function showResults() {
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) {
        resultsSection.style.display = 'block';
    }
}

// ===== Show/Hide Loading =====
function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        if (show) {
            overlay.classList.add('active');
        } else {
            overlay.classList.remove('active');
        }
    }
}

// ===== Generate YouTube QR Code =====
function generateYouTubeQR() {
    const qrContainer = document.getElementById('qrcode');
    if (!qrContainer) return;
    qrContainer.innerHTML = ''; // Prevent duplication
    new QRCode(qrContainer, {
        text: 'https://www.youtube.com/@percyquasar',
        width: 140,
        height: 140,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });
}

// ===== Export to PDF (Fast, CORS-Safe & Aspect-Ratio Preserving) =====
async function exportToPDF() {
    if (pointsData.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    showLoading(true);

    try {
        const { jsPDF } = window.jspdf;
        if (!jsPDF) throw new Error('jsPDF no está cargado');

        const title = document.getElementById('pdfTitle').value || 'Levantamiento Topográfico';
        const pageSize = document.getElementById('pageSize').value || 'a4';

        const pageSizes = {
            a4: { width: 297, height: 210, orientation: 'landscape' },
            a3: { width: 420, height: 297, orientation: 'landscape' }
        };

        const config = pageSizes[pageSize] || pageSizes.a4;
        const pdf = new jsPDF(config.orientation, 'mm', pageSize);

        const margin = 10;
        const pageWidth = config.width;
        const pageHeight = config.height;

        // ===== Title Block =====
        const titleBlockHeight = pageSize === 'a3' ? 32 : 26;
        const titleBlockY = margin;

        pdf.setDrawColor(30, 41, 59);
        pdf.setLineWidth(0.4);
        pdf.rect(margin, titleBlockY, pageWidth - 2 * margin, titleBlockHeight);

        // Header Title
        pdf.setFontSize(pageSize === 'a3' ? 14 : 11);
        pdf.setFont(undefined, 'bold');
        pdf.setTextColor(15, 23, 42);
        const cleanTitle = title.length > 55 ? title.substring(0, 55) + '...' : title;
        pdf.text(cleanTitle, margin + 4, titleBlockY + 7);

        // Header Stats
        pdf.setFontSize(pageSize === 'a3' ? 8.5 : 7.5);
        pdf.setFont(undefined, 'normal');

        const epsgCode = document.getElementById('epsgCode').value || '32718';
        const dateStr = new Date().toLocaleDateString('es-ES');
        const statsY = titleBlockY + (pageSize === 'a3' ? 16 : 14);
        const col2 = margin + (pageSize === 'a3' ? 120 : 95);
        const col3 = margin + (pageSize === 'a3' ? 240 : 185);

        pdf.setFont(undefined, 'bold');
        pdf.text(`Área: ${currentMetrics.area.toFixed(2)} m² (${currentMetrics.areaHa.toFixed(4)} Ha)`, margin + 4, statsY);
        pdf.text(`Perímetro: ${currentMetrics.perimeter.toFixed(2)} m`, col2, statsY);

        pdf.text(`Vértices: ${currentMetrics.pointCount}`, margin + 4, statsY + 5.5);
        pdf.text(`EPSG: ${epsgCode}`, col2, statsY + 5.5);
        pdf.text(`Fecha: ${dateStr}`, col3, statsY);

        // ===== Layout Calculations =====
        const tableWidth = pageSize === 'a3' ? 95 : 80;
        const gap = 5;
        const maxMapWidth = pageWidth - (2 * margin) - tableWidth - gap;
        const footerHeight = 8;
        const maxMapHeight = pageHeight - margin - footerHeight - (titleBlockY + titleBlockHeight + gap);
        const mapY = titleBlockY + titleBlockHeight + gap;

        // ===== Map Capture =====
        const mapElement = document.getElementById('map');
        map.invalidateSize({ animate: false });

        const canvas = await html2canvas(mapElement, {
            useCORS: true,
            allowTaint: false,
            scale: 1.5,
            logging: false
        });

        // Compute aspect ratio so map is never stretched or distorted
        const canvasAspect = canvas.width / canvas.height;
        const targetAspect = maxMapWidth / maxMapHeight;

        let renderMapWidth = maxMapWidth;
        let renderMapHeight = maxMapHeight;

        if (canvasAspect > targetAspect) {
            renderMapHeight = maxMapWidth / canvasAspect;
        } else {
            renderMapWidth = maxMapHeight * canvasAspect;
        }

        const mapX = margin + (maxMapWidth - renderMapWidth) / 2;
        const mapImgY = mapY + (maxMapHeight - renderMapHeight) / 2;

        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        pdf.addImage(imgData, 'JPEG', mapX, mapImgY, renderMapWidth, renderMapHeight);

        // Map Border
        pdf.setDrawColor(100, 116, 139);
        pdf.setLineWidth(0.3);
        pdf.rect(mapX, mapImgY, renderMapWidth, renderMapHeight);

        // ===== Table Section =====
        const tableX = margin + maxMapWidth + gap;

        pdf.setFontSize(pageSize === 'a3' ? 9 : 8);
        pdf.setFont(undefined, 'bold');
        pdf.text('Cuadro de Construcción Topográfico', tableX + (tableWidth / 2), mapY + 2, { align: 'center' });

        const headers = ['Vért.', 'Lado', 'Dist (m)', 'Este (X)', 'Norte (Y)', 'Cota (Z)'];
        const tableData = currentMetrics.segments.map(s => {
            const p = pointsData.find(pt => pt.numero === s.from) || pointsData[s.index - 1];
            return [
                String(s.from),
                `${s.from}-${s.to}`,
                s.distance.toFixed(2),
                p.este.toFixed(3),
                p.norte.toFixed(3),
                p.altura.toFixed(2)
            ];
        });

        pdf.autoTable({
            startY: mapY + 4,
            head: [headers],
            body: tableData,
            theme: 'grid',
            margin: { left: tableX },
            tableWidth: tableWidth,
            headStyles: {
                fillColor: [30, 41, 59],
                textColor: 255,
                fontStyle: 'bold',
                halign: 'center',
                fontSize: pageSize === 'a3' ? 7.5 : 6.5,
                cellPadding: 1.2
            },
            bodyStyles: {
                fontSize: pageSize === 'a3' ? 6.5 : 5.8,
                cellPadding: 0.9,
                valign: 'middle'
            },
            columnStyles: {
                0: { cellWidth: 10, halign: 'center' },
                1: { cellWidth: 12, halign: 'center' },
                2: { cellWidth: 13, halign: 'right' },
                3: { cellWidth: 'auto', halign: 'right' },
                4: { cellWidth: 'auto', halign: 'right' },
                5: { cellWidth: 11, halign: 'right' }
            }
        });

        // ===== Footer =====
        pdf.setFontSize(7);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Generado: ${new Date().toLocaleString('es-ES')}`, pageWidth / 2, pageHeight - 4, { align: 'center' });
        pdf.text(`Hoja: ${pageSize.toUpperCase()}`, pageWidth - margin, pageHeight - 4, { align: 'right' });

        // Save PDF
        pdf.save(`Plano_Topografico_${pageSize.toUpperCase()}_${Date.now()}.pdf`);
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error al generar PDF: ' + (error.message || 'Verifique que la capa satelital permita CORS'));
    } finally {
        showLoading(false);
    }
}

// ===== Export to KML =====
function exportToKML() {
    if (pointsData.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    try {
        const epsgCode = document.getElementById('epsgCode').value || '32718';
        const utmProj = getOrDefineProjection(epsgCode);
        const wgs84Proj = 'EPSG:4326';

        let coordinatesKml = '';
        pointsData.forEach(p => {
            const [lon, lat] = proj4(utmProj, wgs84Proj, [p.este, p.norte]);
            coordinatesKml += `            ${lon.toFixed(8)},${lat.toFixed(8)},${p.altura.toFixed(3)}\n`;
        });

        // Close ring with first vertex
        const pFirst = pointsData[0];
        const [lon0, lat0] = proj4(utmProj, wgs84Proj, [pFirst.este, pFirst.norte]);
        coordinatesKml += `            ${lon0.toFixed(8)},${lat0.toFixed(8)},${pFirst.altura.toFixed(3)}`;

        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Levantamiento Topográfico</name>
    <description>Área: ${currentMetrics.area.toFixed(2)} m2 | Perímetro: ${currentMetrics.perimeter.toFixed(2)} m</description>
    <Style id="polyStyle">
      <LineStyle>
        <color>ff6666f1</color>
        <width>2.5</width>
      </LineStyle>
      <PolyStyle>
        <color>50f18c81</color>
      </PolyStyle>
    </Style>
    <Placemark>
      <name>Polígono</name>
      <styleUrl>#polyStyle</styleUrl>
      <Polygon>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
${coordinatesKml}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

        downloadFile(kml, 'levantamiento_topografico.kml', 'application/vnd.google-earth.kml+xml');
    } catch (error) {
        console.error('Error generando KML:', error);
        alert('Error al generar KML: ' + error.message);
    }
}

// ===== Export to GeoJSON =====
function exportToGeoJSON() {
    if (pointsData.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    try {
        const epsgCode = document.getElementById('epsgCode').value || '32718';
        const utmProj = getOrDefineProjection(epsgCode);
        const wgs84Proj = 'EPSG:4326';

        const coordinates = pointsData.map(point => {
            const [lon, lat] = proj4(utmProj, wgs84Proj, [point.este, point.norte]);
            return [parseFloat(lon.toFixed(8)), parseFloat(lat.toFixed(8)), point.altura];
        });
        coordinates.push(coordinates[0]); // Close polygon

        const geojson = {
            type: 'FeatureCollection',
            name: 'Levantamiento_Topografico',
            features: [{
                type: 'Feature',
                properties: {
                    name: document.getElementById('pdfTitle').value || 'Levantamiento Topográfico',
                    area_m2: parseFloat(currentMetrics.area.toFixed(2)),
                    area_ha: parseFloat(currentMetrics.areaHa.toFixed(4)),
                    perimetro_m: parseFloat(currentMetrics.perimeter.toFixed(2)),
                    puntos: currentMetrics.pointCount,
                    epsg: epsgCode,
                    fecha: new Date().toISOString().split('T')[0]
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                }
            }]
        };

        downloadFile(JSON.stringify(geojson, null, 2), 'levantamiento_topografico.geojson', 'application/geo+json');
    } catch (error) {
        console.error('Error generando GeoJSON:', error);
        alert('Error al generar GeoJSON: ' + error.message);
    }
}

// ===== Export to SHP =====
function exportToSHP() {
    if (pointsData.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    try {
        if (typeof shpwrite === 'undefined') {
            throw new Error('Librería shpwrite no está disponible');
        }

        const epsgCode = document.getElementById('epsgCode').value || '32718';
        const utmProj = getOrDefineProjection(epsgCode);
        const wgs84Proj = 'EPSG:4326';

        // Coordinates in WGS84 standard for universal GIS import
        const coordinates = pointsData.map(point => {
            const [lon, lat] = proj4(utmProj, wgs84Proj, [point.este, point.norte]);
            return [parseFloat(lon.toFixed(8)), parseFloat(lat.toFixed(8))];
        });
        coordinates.push(coordinates[0]);

        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {
                    Nombre: 'Levantamiento',
                    Area_m2: parseFloat(currentMetrics.area.toFixed(2)),
                    Perim_m: parseFloat(currentMetrics.perimeter.toFixed(2)),
                    Puntos: currentMetrics.pointCount
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                }
            }]
        };

        const options = {
            folder: 'levantamiento_shapefile',
            types: {
                polygon: 'poligono'
            }
        };

        shpwrite.download(geojson, options);
    } catch (error) {
        console.error('Error generando SHP:', error);
        alert('Error al generar SHP: ' + error.message);
    }
}

// ===== Export to GPKG =====
function exportToGPKG() {
    alert('La exportación directa a GPKG (GeoPackage binario) requiere compresión SQLite en el cliente o servidor. Se descargará el formato estándar GeoJSON compatible con QGIS y ArcGIS.');
    exportToGeoJSON();
}

// ===== Download File Helper =====
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
