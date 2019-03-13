var reproject = require('reproject');
var epsg = require('epsg');

// Globals
var map;
var binUrl;
var binApiUrl;
var heatmapValues;
var heatmapColors;
var opacity = 80;

$("#opacityRange").on('input propertychange', function () {
    opacity = $(this).val();
    $("#opacityValue").text(opacity);
    saveColors();
});

$("#colorInput").change(function () {
    if (validateHeatmapInput()) {
        saveColors();
        createHeatmap();
    }
});

$("#scaleInput").change(function () {
    if (validateHeatmapInput()) {
        saveColors();
        createHeatmap();
    }
});

$("#binUrlField").change(function () {
    binUrl = $(this).val();
    saveBinUrl();
    redrawMap();
});

$("#refresh").click(function () {
    redrawMap();
});

function refreshLastUpdateTimes(lastBindUpdate) {
    $("#lastRefresh").text(moment().format("DD/M/YYYY HH:mm:ss"));
    $("#lastBinUpdate").text(moment(lastBindUpdate).format("DD/M/YYYY HH:mm:ss"));
}

function validateHeatmapInput() {
    var colors = $("#colorInput").val().trim().replace(/ /g, "").split(",");
    var values = $("#scaleInput").val().trim().split(",").map(function (item) {
        return parseInt(item);
    });

    var error = false;
    var errorMsg;

    if (colors.length !== values.length) {
        error = true;
        errorMsg = "Provide an equal amount of colors and range values."
    } else if (!validColors(colors)) {
        error = true;
        errorMsg = "Provide valid hex colors."

    } else if (!validRanges(values)) {
        error = true;
        errorMsg = "Provide a valid range of ascending integer values."
    }

    if (error) {
        $("#scaleErrorMsg").text(errorMsg);
        $("#scaleError").show();
        return false;
    } else {
        $("#scaleError").hide();
        heatmapColors = colors;
        heatmapValues = values;
        return true;
    }
}

function validColors(array) {
    for (var i = 0; i < array.length; i++) {
        var isValidHexColor  = /^#[0-9A-F]{6}$/i.test(array[i]);
        if (!isValidHexColor) {
            return false;
        }
    }
    return true;
}

function validRanges(array) {
    for (var i = 0; i < array.length; i++) {
        if (!$.isNumeric(array[i])) {
            return false;
        }

        if (i > 0 && parseInt(array[i - 1]) > parseInt(array[i])) {
            return false
        }
    }
    return true;
}

function createHeatmap() {
    $("#scaleLabels").empty();
    heatmapValues.forEach(function (value, index, array) {
        var text;
        if (index === 0) {
            text = "<" + heatmapValues[index];
        } else if (index === array.length - 1) {
            text = heatmapValues[index - 1] + " - " + heatmapValues[index] + "+";
        } else {
            text = heatmapValues[index - 1] + " - " + heatmapValues[index];
        }
        var labelColor = heatmapColors[index];

        var fontColor = retrieveFontColor(labelColor);

        $("#scaleLabels").append(`<div class='ui horizontal label' style='background-color: ${labelColor}; color: ${fontColor}'>${text}</div>`);
    });
}

function retrieveFontColor(labelColor) {
    var rgbColor = hexToRgb(labelColor);
    var hsp = Math.sqrt(
        0.299 * (rgbColor.r * rgbColor.r) +
        0.587 * (rgbColor.g * rgbColor.g) +
        0.114 * (rgbColor.b * rgbColor.b)
    );

    if (hsp > 127.5) {
        return "black";
    } else {
        return "white";
    }
}

function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function saveColors() {
    map.data.setStyle(function (feature) {
        var national = feature.getProperty('national');
        var color;

        if (national == null) {
            color = 'gray';
        } else {
            var i = 0;
            while (national > heatmapValues[i] && i < heatmapValues.length - 1) {
                i = i + 1;
            }
            color = heatmapColors[i];
        }
        return {
            fillColor: color,
            strokeWeight: 1,
            fillOpacity: opacity / 100
        };
    });
}

function saveBinUrl() {
    if (!binUrl.trim().startsWith("https://kara.rest/bin/")) {
        $("#errorLabel").show();
    } else {
        $("#errorLabel").hide();
        var strippedBinId = binUrl.trim().replace("https://kara.rest/bin/", "").replace("/", "");
        binApiUrl = "https://kara.rest/api/v1/bins/" + strippedBinId + "/requests?fields=body,requestTime&limit=1";
    }
}

function drawLambertWKTWithData(wkt, map, national, international, size) {
    var geoJson = wellknown.parse(wkt);
    var feature = {
        type: "Feature",
        geometry: geoJson,
        properties: {national: national, international: international, size: size}
    };
    map.data.addGeoJson(reproject.reproject(feature, 'EPSG:3035', 'EPSG:4326', epsg));
}

function initAll() {
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 10,
        center: {lat: 51.025183, lng: 3.894707}
    });
    validateHeatmapInput();
    createHeatmap();
    saveColors();
    redrawMap();
    setInterval(function () {
        redrawMap();
    }, 30000); // Autorefresh every 30s
}

function redrawMap() {
    var data = new XMLHttpRequest();
    data.onreadystatechange = function () {
        if (data.readyState === XMLHttpRequest.DONE) {
            var jsonResponse = JSON.parse(data.responseText);
            if (jsonResponse[0] === undefined) {
                return;
            }
            var newData = JSON.parse(jsonResponse[0].body).data;
            map.data.forEach(function (feature) {
                // If you want, check here for some constraints.
                map.data.remove(feature);
            });
            newData.forEach(function (cell) {
                var counter = 0;
                var cellSplit = [];
                var pow = false;
                if (cell.binId.includes("km")) {
                    cellSplit = /([^k]+)kmE([^N]+)N(.*)/g.exec(cell.binId);
                    counter = 3;
                    pow = true;
                } else {
                    cellSplit = /([^m]+)mE([^N]+)N(.*)/g.exec(cell.binId);
                }
                var tempCell = cellSplit[1];
                while (tempCell % 10 === 0) {
                    counter++;
                    tempCell = tempCell / 10;
                }
                var step;
                if (pow) {
                    step = cellSplit[1] * Math.pow(10, counter);
                } else {
                    step = cellSplit[1];
                }
                var east = cellSplit[2] * Math.pow(10, counter);
                var north = cellSplit[3] * Math.pow(10, counter);


                var wkt = "POLYGON((" + east + " " + north + ","
                    + (+east + +step) + " " + north + ","
                    + (+east + +step) + " " + (+north + +step) + ","
                    + east + " " + (+north + +step) + ","
                    + east + " " + north +
                    "))";


                drawLambertWKTWithData(wkt, map, cell.national, cell.international, step);
                refreshLastUpdateTimes(jsonResponse[0].requestTime);
            });
        }
    };

    if (binApiUrl != null) {
        data.open('GET', binApiUrl, true);
        data.setRequestHeader("Accept", "application/json");
        data.send(null);
    }
}
