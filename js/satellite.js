/* js/satellite.js — live satellite cloud, the "Now" mode (#F2c).
 *
 * DATA + LAYER, no UI. js/cloud.js is the sibling that owns the climatology.
 *
 * FOUR STEPS, AND NOTHING ELSE.
 *
 *   1. every pixel becomes a BRIGHTNESS TEMPERATURE
 *   2. cloud is how far that falls BELOW THE LOCAL SURFACE temperature
 *   3. that depression becomes a PROBABILITY OF CLOUD, from a measured curve
 *   4. satellites are combined by VIEWING GEOMETRY
 *
 * Every constant below traces to a measurement stated beside it. Anything that
 * cannot be traced that way has been removed — earlier versions of this file
 * carried a median filter, an edge feather, a share threshold, a ground
 * percentile and three opacity curves, each added in response to one screenshot,
 * and together they were most of the file and most of its errors.
 *
 * STEP 1 — TEMPERATURE, NOT BRIGHTNESS.
 * GIBS does not render GOES and Himawari infrared as greyscale: tops colder than
 * about -12C come back in saturated colours whose channel average lands
 * mid-range. Measured over North America:
 *
 *     deepest tops   -90 to -50 C   channel mean 131
 *     mid cloud      -20 to   0 C   channel mean 163
 *     clear ground     0 to  40 C   channel mean 112
 *
 * Brightness is NOT MONOTONIC in temperature, so any rule written on brightness
 * erases the deepest cloud — holes in the middle of storms, the worst place on
 * this map to be wrong. GIBS publishes the colour map that inverts its own
 * rendering exactly; EUMETSAT publishes none, so its greyscales are
 * quantile-matched to GOES temperature in the overlap each shares, which is
 * monotone by construction and re-derivable.
 *
 * STEP 2 — THE SURFACE REFERENCE IS TEMPORAL, BECAUSE CLOUD MOVES AND TERRAIN
 * DOES NOT. The clear-sky temperature of a pixel is the WARMEST that pixel has
 * been across recent frames: cloud drifts off a place within a few hours and
 * leaves the ground behind, so the maximum over time is the ground.
 *
 * Taking it from NEIGHBOURING PIXELS instead — the previous method — cannot
 * distinguish cold cloud from cold ground, and every highland therefore read as
 * cloud. Measured against GOES's own simultaneous visible band: Denver, at
 * 1600 m and plainly sunny, sat 5.9C below the warmest land within reach and was
 * drawn as cloud. With a temporal background it sits 1.1C below its own clear-sky
 * value and is correctly left clear. Over the same box the painted area fell from
 * 61% to 39% against a visible band saying 17%.
 *
 * NOTHING SPATIAL SITS ON TOP OF IT. The background is already per pixel. An
 * intermediate version kept the old cell percentile and neighbour search as
 * well, and warmest-of-warmest-of-warmest painted 81% of the United States
 * against a visible band saying 20%. Used directly: 22%.
 *
 * STEP 3 — THE OPACITY CURVE IS MEASURED, NOT CHOSEN.
 * Against EUMETSAT's operational cloud mask over six regions, 1.49 million
 * labelled pixels, the probability that a pixel is cloud given its depression:
 *
 *     dT   0-3   3-6   6-9   9-12  12-15  15-18   18+
 *     P   0.11  0.56  0.75  0.88   0.98   0.99  0.99
 *
 * A logistic through those points centres at 5.3C with a width of 2.4C. Opacity
 * IS that probability. Nothing is thresholded, so there is no cliff to fall off
 * and no edge to feather.
 *
 * COLOUR is the depression itself — cloud-top height, the other thing infrared
 * actually knows. Full tone at 37C, the 90th percentile of cloud in the same
 * measurement.
 *
 * STEP 4 — GEOMETRY.
 * Every satellite contributes everywhere it can see, weighted by cos^3 of the
 * angle from its sub-satellite point, reaching zero AT the limb rather than
 * stepping off it. Nothing picks a satellite, so nothing can pick wrong, and
 * there is no boundary for a residual difference to show up along.
 *
 * WHAT INFRARED CANNOT DO, stated rather than papered over: it cannot see cloud
 * that is nearly as warm as the ground beneath it. Low marine stratus is the
 * clearest case — over the open Atlantic this under-reports against the mask —
 * and it is exactly the cloud that ruins an eclipse. The fix is a visible-band
 * or mask channel that ADDS cloud, never a constant that inflates this one.
 *
 * Never guess a layer identifier. A wrong one fails as a silently blank layer,
 * and on this map blank reads as CLEAR SKY.
 */
(function () {
  'use strict';

  /* GIBS serves the same imagery from two endpoints. They RENDER IDENTICALLY —
     measured, same-frame RGB difference 0.000 — but they are independent caches
     and do not populate a given frame at the same moment. Over 9 observations,
     3 had one endpoint a full 10-minute step ahead of the other, in both
     directions: GOES-East was fresher on 'all' in one trial and on 'best' in the
     next. Mean saving 3.3 min, never more than one step. Small, but free, and it
     comes with the probe below, which is the real gain. */
  var GIBS   = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/';
  var GIBS_EP = ['best', 'all'];
  var EUM    = 'https://view.eumetsat.int/geoserver/wms';
  var CREDIT = 'Imagery NASA EOSDIS GIBS \u00b7 EUMETSAT';

  /* Both services speak WMS 1.3.0 with CRS=EPSG:3857 and bbox in metres. The
     1.3.0 axis flip applies to EPSG:4326 (lat,lon); using 4326 without swapping
     returns an empty image and NO error. EUMETSAT advertises only 4326 for these
     layers and serves 3857 correctly anyway — verified against the live service.

     mtg_fd:ir105_hrfi is Meteosat Third Generation's high-rate infrared: finer
     and fresher than SEVIRI's ir108, measured 19 minutes old against 29. */
  var SATS = [
    { id: 'goes-east', name: 'GOES-East',        lon:  -75.2, svc: 'gibs', step: 10, temp: 'cmap',
      layer: 'GOES-East_ABI_Band13_Clean_Infrared' },
    { id: 'goes-west', name: 'GOES-West',        lon: -137.0, svc: 'gibs', step: 10, temp: 'cmap',
      layer: 'GOES-West_ABI_Band13_Clean_Infrared' },
    { id: 'mtg',       name: 'Meteosat 0\u00b0', lon:    0.0, svc: 'eum',  step: 10, temp: 'mtg',
      layer: 'mtg_fd:ir105_hrfi' },
    { id: 'iodc',      name: 'Meteosat IODC',    lon:   45.5, svc: 'eum',  step: 15, temp: 'iodc',
      layer: 'msg_iodc:ir108' },
    { id: 'himawari',  name: 'Himawari',         lon:  140.7, svc: 'gibs', step: 10, temp: 'cmap',
      layer: 'Himawari_AHI_Band13_Clean_Infrared' }
  ];

  /* --- step 3 constants, from the table in the header --------------------- */
  var P_MID = 5.3, P_WIDTH = 2.4;   /* logistic centre and width, degrees C */
  var P_DRAW = 0.5;                 /* draw where cloud is likelier than not */
  var T_FULL = 37;                  /* deepest tone: 90th percentile of cloud */

  /* --- step 2 constants --------------------------------------------------- */
  var BG_FRAMES = 10;               /* past frames behind the current one. WAS FOUR,
                                       and four is not enough where weather sits
                                       still. Measured over the Gulf and Caribbean
                                       at zoom 5, holding the imagery constant and
                                       swapping only the background: at four days
                                       the clear-sky reference inside a storm read
                                       4.6C against 11.4C two pixels outside it, so
                                       the storm was measured against its own tops
                                       and hollowed out. Drawn area 29.1% at four
                                       days, 36.2% at ten, and the large holes
                                       close. The published method uses twenty; ten
                                       is a compromise with the request count, and
                                       the cache below is what pays for it. */
  var BG_GAP_MIN = 1440;            /* ONE DAY APART, SAME TIME OF DAY. Hours apart
                                       is not enough: cloud that sits over a place
                                       for an afternoon becomes its own clear-sky
                                       value and the storm punches holes in itself,
                                       which is visible as a moth-eaten layer.
                                       Same time of day on previous days has no
                                       diurnal bias to correct, and four days is
                                       long enough for cloud to have moved. The
                                       published method composites twenty days of
                                       the second-warmest value; this is the same
                                       idea at four. */
                 /* the background is smooth, so it is fetched
                                       at a third of the width — four extra
                                       requests at a ninth of the pixels */
  var BG_TTL = 6 * 60 * 60 * 1000;  /* THE GROUND DOES NOT MOVE, and this is built
                                       from frames a day apart, so half an hour was
                                       far shorter than anything it measures — it
                                       just made a browser left open re-fetch ten
                                       frames per satellite for no change. Six
                                       hours still refreshes it several times a day
                                       and is what makes ten frames affordable. */

  /* --- step 4 constants --------------------------------------------------- */
  var CUT = 0.16;                   /* cos of the limb angle, ~81 degrees */
  var TAIL = 0.05;                  /* satellites are fetched in descending weight
                                       until those left out carry less than this
                                       share of the total, so omitting them cannot
                                       move the weighted mean by more than 5% */

  var R = 6378137, LAT_MAX = 85.0511287798066;
  var MIN_PX = 256, MARGIN = 0.15;
  /* Canvas resolution follows the display. At 720 across a hemisphere a pixel is
     thirty kilometres and cloud can only come out blocky, whatever else is
     right. Cost measured per request: 850px 0.5s, 1100px 1.6s — so the cap sits
     where detail stops being free rather than where it stops being visible. */
  var MAX_PX = 1024;
  var TTL = 5 * 60 * 1000, MAX_AGE_MIN = 180, MAX_STEPS = 8;

  /* GIBS publishes this colour map for Clean_Longwave_Infrared_Window_Band:
     [r, g, b, degreesC], 237 entries, every RGB distinct, so the rendering is
     exactly invertible back to what the instrument measured. */
  var CMAP = [[255, 255, 255, -91.6], [127, 0, 127, -90.6], [140, 13, 135, -89.6], [153, 25, 142, -88.6], [165, 38, 150, -87.6], [178, 51, 157, -86.6], [191, 64, 165, -85.6], [204, 76, 173, -84.6], [217, 89, 180, -83.6], [229, 102, 188, -82.6], [242, 114, 195, -81.6], [255, 127, 203, -80.6], [230, 230, 230, -79.6], [204, 204, 204, -78.6], [177, 177, 177, -77.6], [155, 155, 155, -76.6], [129, 129, 129, -75.6], [102, 102, 102, -74.6], [76, 76, 76, -73.6], [54, 54, 54, -72.6], [27, 27, 27, -71.6], [5, 5, 5, -70.6], [26, 0, 0, -69.6], [51, 0, 0, -68.6], [77, 0, 0, -67.6], [102, 0, 0, -66.6], [128, 0, 0, -65.6], [153, 0, 0, -64.6], [179, 0, 0, -63.6], [204, 0, 0, -62.6], [230, 0, 0, -61.6], [255, 0, 0, -60.6], [255, 26, 0, -59.6], [255, 51, 0, -58.6], [255, 77, 0, -57.6], [255, 102, 0, -56.6], [255, 128, 0, -55.6], [255, 153, 0, -54.6], [255, 179, 0, -53.6], [255, 204, 0, -52.6], [255, 230, 0, -51.6], [255, 255, 0, -50.6], [230, 255, 0, -49.6], [204, 255, 0, -48.6], [179, 255, 0, -47.6], [153, 255, 0, -46.6], [128, 255, 0, -45.6], [102, 255, 0, -44.6], [77, 255, 0, -43.6], [51, 255, 0, -42.6], [26, 255, 0, -41.6], [0, 255, 0, -40.6], [0, 234, 10, -39.6], [0, 212, 19, -38.6], [0, 191, 29, -37.6], [0, 170, 38, -36.6], [0, 149, 48, -35.6], [0, 128, 58, -34.6], [0, 106, 67, -33.6], [0, 85, 77, -32.6], [0, 64, 86, -31.6], [0, 42, 96, -30.9], [0, 21, 105, -30.4], [0, 0, 115, -29.9], [0, 0, 125, -29.4], [0, 13, 122, -28.9], [0, 26, 129, -28.4], [0, 38, 136, -27.9], [0, 51, 143, -27.4], [0, 64, 150, -26.9], [0, 76, 157, -26.4], [0, 89, 164, -25.9], [0, 102, 171, -25.4], [0, 115, 178, -24.9], [0, 128, 185, -24.4], [0, 140, 192, -23.9], [0, 153, 199, -23.4], [0, 166, 206, -22.9], [0, 178, 213, -22.4], [0, 191, 220, -21.9], [0, 204, 227, -21.4], [0, 217, 234, -20.9], [0, 230, 241, -20.4], [0, 242, 248, -19.9], [0, 255, 255, -19.4], [197, 197, 197, -18.9], [196, 196, 196, -18.4], [194, 194, 194, -17.9], [193, 193, 193, -17.4], [192, 192, 192, -16.9], [191, 191, 191, -16.4], [189, 189, 189, -15.9], [188, 188, 188, -15.3], [187, 187, 187, -14.8], [185, 185, 185, -14.3], [184, 184, 184, -13.8], [183, 183, 183, -13.3], [181, 181, 181, -12.8], [180, 180, 180, -12.3], [179, 179, 179, -11.8], [178, 178, 178, -11.3], [176, 176, 176, -10.8], [175, 175, 175, -10.3], [174, 174, 174, -9.8], [172, 172, 172, -9.3], [171, 171, 171, -8.8], [170, 170, 170, -8.3], [169, 169, 169, -7.8], [167, 167, 167, -7.3], [166, 166, 166, -6.8], [165, 165, 165, -6.3], [163, 163, 163, -5.8], [162, 162, 162, -5.3], [161, 161, 161, -4.8], [159, 159, 159, -4.3], [158, 158, 158, -3.8], [157, 157, 157, -3.4], [156, 156, 156, -2.9], [154, 154, 154, -2.4], [153, 153, 153, -1.9], [152, 152, 152, -1.4], [150, 150, 150, -0.9], [149, 149, 149, -0.3], [148, 148, 148, 0.2], [147, 147, 147, 0.7], [145, 145, 145, 1.1], [144, 144, 144, 1.6], [143, 143, 143, 2.1], [141, 141, 141, 2.6], [140, 140, 140, 3.1], [139, 139, 139, 3.6], [138, 138, 138, 4.2], [136, 136, 136, 4.7], [135, 135, 135, 5.2], [134, 134, 134, 5.7], [132, 132, 132, 6.2], [131, 131, 131, 6.7], [130, 130, 130, 7.2], [128, 128, 128, 7.7], [127, 127, 127, 8.2], [126, 126, 126, 8.7], [125, 125, 125, 9.2], [123, 123, 123, 9.7], [122, 122, 122, 10.2], [121, 121, 121, 10.7], [119, 119, 119, 11.2], [118, 118, 118, 11.7], [117, 117, 117, 12.2], [116, 116, 116, 12.7], [114, 114, 114, 13.2], [113, 113, 113, 13.7], [112, 112, 112, 14.2], [110, 110, 110, 14.7], [109, 109, 109, 15.2], [108, 108, 108, 15.7], [106, 106, 106, 16.1], [105, 105, 105, 16.6], [104, 104, 104, 17.1], [103, 103, 103, 17.6], [101, 101, 101, 18.1], [100, 100, 100, 18.6], [99, 99, 99, 19.1], [97, 97, 97, 19.6], [96, 96, 96, 20.1], [95, 95, 95, 20.6], [94, 94, 94, 21.1], [92, 92, 92, 21.6], [91, 91, 91, 22.1], [90, 90, 90, 22.6], [88, 88, 88, 23.1], [87, 87, 87, 23.6], [86, 86, 86, 24.1], [84, 84, 84, 24.6], [83, 83, 83, 25.1], [82, 82, 82, 25.6], [81, 81, 81, 26.1], [79, 79, 79, 26.6], [78, 78, 78, 27.1], [77, 77, 77, 27.6], [75, 75, 75, 28.1], [74, 74, 74, 28.6], [73, 73, 73, 29.1], [72, 72, 72, 29.6], [70, 70, 70, 30.1], [69, 69, 69, 30.6], [68, 68, 68, 31.1], [66, 66, 66, 31.6], [65, 65, 65, 32.1], [64, 64, 64, 32.6], [62, 62, 62, 33.1], [61, 61, 61, 33.6], [60, 60, 60, 34.1], [59, 59, 59, 34.6], [57, 57, 57, 35.1], [56, 56, 56, 35.6], [55, 55, 55, 36.1], [53, 53, 53, 36.6], [52, 52, 52, 37.1], [51, 51, 51, 37.6], [50, 50, 50, 38.1], [48, 48, 48, 38.6], [47, 47, 47, 39.1], [46, 46, 46, 39.6], [44, 44, 44, 40.1], [43, 43, 43, 40.6], [42, 42, 42, 41.1], [41, 41, 41, 41.6], [39, 39, 39, 42.1], [38, 38, 38, 42.6], [37, 37, 37, 43.1], [35, 35, 35, 43.6], [34, 34, 34, 44.1], [33, 33, 33, 44.6], [31, 31, 31, 45.1], [30, 30, 30, 45.6], [29, 29, 29, 46.1], [28, 28, 28, 46.6], [26, 26, 26, 47.1], [25, 25, 25, 47.6], [24, 24, 24, 48.1], [22, 22, 22, 48.6], [21, 21, 21, 49.1], [20, 20, 20, 49.6], [19, 19, 19, 50.1], [17, 17, 17, 50.6], [16, 16, 16, 51.1], [15, 15, 15, 51.6], [13, 13, 13, 52.1], [12, 12, 12, 52.6], [11, 11, 11, 53.1], [9, 9, 9, 53.6], [8, 8, 8, 54.1], [7, 7, 7, 54.6], [6, 6, 6, 55.1], [4, 4, 4, 55.6], [3, 3, 3, 56.1], [2, 2, 2, 56.6]];

  /* EUMETSAT publishes no temperature scale for its greyscales, so these were
     derived by quantile-matching against GOES temperature in the overlap each
     shares — monotone by construction. mtg grey 10 is +23C ocean, 130 is -47C
     cloud top. Re-derive with tools/checks/ if a provider restyles a layer. */
  var EUM_T = {"mtg": [23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 22.9, 21.6, 21.6, 20.6, 20.4, 19.1, 19.1, 17.6, 17.6, 16.1, 16.1, 15.2, 15.2, 14.2, 14.2, 13.2, 13.2, 12.7, 12.7, 11.7, 11.7, 10.7, 10.4, 10.2, 9.9, 9.2, 8.7, 8.2, 7.4, 6.7, 6.2, 5.7, 5.2, 4.7, 4.2, 3.6, 3.1, 2.5, 1.9, 1.3, 0.7, 0.2, -0.1, -0.4, -0.7, -1.0, -1.3, -1.6, -1.9, -2.2, -2.5, -2.8, -3.1, -3.4, -3.7, -4.0, -4.4, -4.8, -5.1, -5.4, -5.8, -6.2, -6.5, -6.8, -7.2, -7.5, -7.8, -8.1, -8.4, -8.7, -9.0, -9.3, -9.7, -10.0, -10.3, -10.6, -10.9, -11.2, -11.5, -11.8, -13.0, -14.1, -15.2, -16.3, -17.4, -18.6, -19.7, -20.8, -21.9, -23.0, -24.2, -25.3, -26.4, -27.5, -28.6, -29.7, -30.9, -32.0, -33.1, -34.2, -35.3, -36.5, -37.6, -38.7, -39.8, -40.9, -42.0, -43.2, -44.3, -45.4, -46.5, -47.6, -48.8, -49.9, -51.0, -52.1, -53.2, -54.3, -55.5, -56.6, -57.7, -58.8, -59.9, -61.1, -62.2, -63.3, -64.4, -65.5, -66.7, -67.8, -68.9, -70.0, -71.1, -72.2, -73.4, -74.5, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6], "iodc": [23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 23.1, 21.6, 21.1, 20.6, 20.6, 19.1, 17.6, 17.6, 17.6, 16.1, 16.1, 15.2, 15.2, 14.2, 13.2, 12.9, 12.7, 12.3, 12.0, 11.7, 11.3, 11.0, 10.7, 10.3, 9.9, 9.5, 9.2, 8.7, 8.2, 7.7, 7.2, 6.7, 6.3, 6.0, 5.7, 5.3, 5.0, 4.7, 4.3, 4.0, 3.7, 3.4, 3.1, 2.8, 2.5, 2.1, 1.8, 1.4, 1.0, 0.7, 0.3, -0.1, -0.4, -0.6, -0.8, -1.0, -1.2, -1.3, -1.5, -1.7, -1.9, -2.0, -2.2, -2.4, -2.6, -2.8, -3.0, -3.3, -3.5, -3.8, -4.0, -4.3, -4.6, -4.8, -5.1, -5.3, -5.6, -5.8, -6.1, -6.3, -6.6, -6.8, -7.1, -7.3, -7.6, -7.8, -8.1, -8.3, -8.6, -8.8, -9.1, -9.3, -9.6, -9.8, -10.1, -10.3, -10.6, -11.4, -12.3, -13.1, -13.9, -14.8, -15.6, -16.4, -17.3, -18.1, -19.0, -19.8, -20.6, -21.5, -22.3, -23.1, -24.0, -24.8, -25.6, -26.5, -27.3, -28.1, -29.0, -29.8, -30.6, -31.5, -32.3, -33.2, -34.0, -34.8, -35.7, -36.5, -37.3, -38.2, -39.0, -39.8, -40.7, -41.5, -42.3, -43.2, -44.0, -44.9, -45.7, -46.5, -46.9, -47.3, -47.6, -48.0, -48.4, -48.8, -49.1, -49.5, -49.9, -50.2, -50.6, -51.0, -51.4, -51.7, -52.1, -52.5, -52.9, -53.2, -53.6, -54.0, -54.3, -54.7, -55.1, -55.5, -55.8, -56.2, -56.6, -57.0, -57.3, -57.7, -58.1, -58.5, -58.8, -59.2, -59.6, -59.9, -60.3, -60.7, -61.1, -61.4, -61.8, -62.2, -62.6, -62.9, -63.3, -63.7, -64.0, -64.4, -64.8, -65.2, -65.5, -65.9, -66.3, -66.7, -67.0, -67.4, -67.8, -68.1, -68.5, -68.9, -69.3, -69.6, -70.0, -70.4, -70.8, -71.1, -71.5, -71.9, -72.2, -72.6, -73.0, -73.4, -73.7, -74.1, -74.5, -74.9, -75.2, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6, -75.6]};

  var SRC = 'sat-now', LAYER = 'sat-now';

  var _on = false, _map = null, _busy = false, _again = false, _pending = null;
  var _stamps = [], _missing = [], _err = null, _listeners = [];
  var _lut = null, _cube = null, _at = 0, _painted = 0, _lastGood = {};
  var _timing = {};        /* last render's phase split, read by diagnose()   */
  /* PARALLEL WORK IS MEASURED AS A MAXIMUM, NOT A SUM. Frames are fetched at
     once, so what a phase costs the user is its slowest instance, not the total
     across all of them. decode is the exception and sums, because getImageData
     runs on the one main thread and every frame's share is serial. */
  var _tProbe = 0, _tImg = 0, _tBg = 0, _tDecode = 0;
  var _cv = null, _ctx = null, _src = null, _drawn = null, _drawnZoom = 0;
  var _scratch = null, _sctx = null;

  /* ------------------------------------------------------------ projection */

  function mercY(lat) { return R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
  function invMercY(y) { return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI; }

  /* MapLibre binds with LINEAR_MIPMAP_NEAREST and falls back to LINEAR only when
     the size is NOT square-and-power-of-two. No mipmaps exist here, so a
     1024x1024 texture samples as BLACK. Same trap as Cloud._safeSize(). */
  function safeSize(w, h) {
    var pot = function (v) { return (Math.log(v) / Math.LN2) % 1 === 0; };
    if (w === h && pot(w)) h -= 1;
    return [w, h];
  }

  /* From zoom and centre, never getBounds(): in globe projection getBounds()
     reports the whole world at almost any zoom, and this module once fetched
     five satellites at world extent on every pan because of it. MapLibre's world
     is exactly 512 * 2^zoom pixels across in both Mercator axes. */
  /* The map is a PARAMETER, defaulting to this module's own. js/imagery.js
     borrows this function so the globe sizing and the dateline rules have one
     home rather than two — but it runs when THIS module is off, and _map is null
     then, so reading it directly threw on the first line of the picture mode's
     render and nothing ever drew. */
  function viewBox(m) {
    m = m || _map;
    var c = m.getCenter(), z = m.getZoom(), el = m.getCanvas();
    var worldPx = 512 * Math.pow(2, z), m = 1 + 2 * MARGIN;
    var lonSpan = el.width / worldPx * 360 * m;
    var ySpan = el.height / worldPx * (2 * mercY(LAT_MAX)) * m;

    /* A GLOBE SHOWS MORE THAN A MERCATOR RECTANGLE OF THE SAME ZOOM, and this
       map is a globe below zoom 6. The sphere compresses toward its limb, so at
       zoom 2 a 745px canvas sees a full hemisphere while 512*2^z predicts 131
       degrees — the outer slice was never requested, and it appeared only once
       rotating carried it far enough inboard to enter the box. §3.4 replaced
       getBounds() with this arithmetic because getBounds() reports the whole
       world in globe projection; the arithmetic that replaced it was Mercator's.

       The sphere's radius on screen is the equator's pixel circumference over
       2*pi, and a point an angle away from the centre lands at radius*sin(angle),
       so the visible half-angle is asin of half the canvas over that radius —
       saturating at 90 degrees, which is the hemisphere and the most a globe can
       show. Divided by cos(latitude) because degrees of longitude are shorter
       away from the equator. Taken as a MAXIMUM against the Mercator figure, so
       a flat map is untouched and the two agree anyway once zoomed in. */
    var globe = false;
    try { globe = !!(m.getProjection && m.getProjection().type === 'globe'); } catch (e) {}
    if (globe) {
      var rPx = worldPx / (2 * Math.PI), D = 180 / Math.PI;
      var aH = Math.asin(Math.min(1, (el.width / 2) / rPx)) * D;
      var aV = Math.asin(Math.min(1, (el.height / 2) / rPx)) * D;
      var cosLat = Math.max(0.25, Math.cos(c.lat * Math.PI / 180));
      lonSpan = Math.max(lonSpan, 2 * aH / cosLat * m);
      ySpan = Math.max(ySpan,
        (mercY(Math.min(LAT_MAX, c.lat + aV)) - mercY(Math.max(-LAT_MAX, c.lat - aV))) * m);
    }

    if (lonSpan >= 355) return { w: -180, e: 180, s: -LAT_MAX, n: LAT_MAX };
    var lng = ((c.lng + 180) % 360 + 360) % 360 - 180;
    var yc = mercY(Math.max(-LAT_MAX, Math.min(LAT_MAX, c.lat)));
    return { w: lng - lonSpan / 2, e: lng + lonSpan / 2,
             s: invMercY(Math.max(mercY(-LAT_MAX), yc - ySpan / 2)),
             n: invMercY(Math.min(mercY(LAT_MAX), yc + ySpan / 2)) };
  }

  function covered() {
    if (!_drawn) return false;
    if (Math.abs(_map.getZoom() - _drawnZoom) > 0.25) return false;
    var b = viewBox();
    return b.w >= _drawn.w && b.e <= _drawn.e && b.s >= _drawn.s && b.n <= _drawn.n;
  }

  /* -------------------------------------------------------------- fetching */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp(sat, ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
           'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00' +
           (sat.svc === 'eum' ? '.000Z' : 'Z');   /* EUMETSAT carries milliseconds,
                                                     GIBS does not; reformatting
                                                     invents a time neither has */
  }

  function url(sat, iso, box, w, h, ep) {
    return (sat.svc === 'gibs' ? GIBS + (ep || GIBS_EP[0]) + '/wms.cgi' : EUM) +
      '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
      '&LAYERS=' + encodeURIComponent(sat.layer) +
      '&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE' +
      '&WIDTH=' + w + '&HEIGHT=' + h +
      '&BBOX=' + (R * box.w * Math.PI / 180) + ',' + mercY(box.s) + ',' +
                 (R * box.e * Math.PI / 180) + ',' + mercY(box.n) +
      '&TIME=' + encodeURIComponent(iso);
  }

  function loadImage(u) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.crossOrigin = 'anonymous';   /* both send permissive CORS; without this the
                                         pixels cannot be read back */
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('image')); };
      im.src = u;
    });
  }

  function readPixels(img, w, h) {
    var _rt = Date.now();
    if (!_scratch) {
      _scratch = document.createElement('canvas');
      _sctx = _scratch.getContext('2d', { willReadFrequently: true });
    }
    if (_scratch.width !== w) _scratch.width = w;
    if (_scratch.height !== h) _scratch.height = h;
    _sctx.clearRect(0, 0, w, h);
    _sctx.drawImage(img, 0, 0, w, h);
    var _px = _sctx.getImageData(0, 0, w, h).data;
    _tDecode += Date.now() - _rt;
    return _px;

  }

  /* THE CATALOGUE LEADS PUBLICATION, and an empty frame is not an error: GIBS
     answers a not-yet-published time with a valid, entirely transparent PNG —
     200 OK, onload fires, nothing in it. Himawari was measured returning three
     such frames in a row. A dropped satellite is a hole and a hole reads as
     CLEAR SKY, so the test is on the PIXELS. The last frame known to have any is
     remembered, because it changes every few minutes and not every pan. */

  function hasPixels(d) {
    var p, lit = 0, m = 0;
    for (p = 3; p < d.length; p += 4 * 61) { m++; if (d[p] > 250) lit++; }
    return lit / m >= 0.01;
  }

  /* A PARTLY-WRITTEN FRAME IS THE ONE FAILURE THE PIXEL TEST ABOVE CANNOT SEE.
     GIBS sometimes publishes a frame with a horizontal slab of the disc missing
     and fills it with OPAQUE PURE WHITE — so alpha says "data" — and white is a
     real entry in the colour map at -91.6C, the coldest cloud top there is. The
     slab therefore decoded as the deepest possible storm and painted a solid red
     band across the equator, with a step where the missing region changed width.
     Observed on GOES-East, 2026-08-19.

     Counting white does NOT work, and two plausible tests were tried and thrown
     away before this one. Measuring white as a share of the frame flags real
     deep convection: one North Atlantic frame is 4% pure white with no defect at
     all, because -91.6C tops are exactly what a storm has. Measuring white per
     row flags the top and bottom of the disc in a polar view, where the ellipse
     narrows and the opaque white surround dominates the row.

     What is unambiguous is a RUN OF EMPTY ROWS WITH IMAGERY ABOVE AND BELOW IT.
     A disc has one continuous vertical extent; a hole inside it is not weather
     and not geometry. Verified across nine archived scenes and thirty-odd
     frames: the one broken frame shows a 14-row slab, every intact frame shows
     none — including the polar and deep-convection cases that defeated the other
     two tests. Rejection steps back to the previous frame, which the walk
     already knows how to do; the rest of a frame published this way is a
     different moment's scan and is not worth keeping either. */
  var SLAB_ROWS = 3;        /* a real gap ran to 14; intact frames give 0 */
  var WHITE_CEIL = 0.50;    /* deepest real convection measured 4% of a frame */

  function partlyWritten(d, w, h) {
    var x, y, n, row, count, mx = 0, lit = 0, white = 0;
    var data = new Int32Array(h);
    for (y = 0; y < h; y++) {
      row = y * w * 4; count = 0;
      for (x = 0; x < w; x += 2) {
        n = row + x * 4;
        if (d[n + 3] <= 250) continue;
        lit++;
        if (d[n] === 255 && d[n + 1] === 255 && d[n + 2] === 255) { white++; continue; }
        count++;
      }
      data[y] = count;
      if (count > mx) mx = count;
    }

    /* THE SLAB TEST BELOW NEEDS IMAGERY ABOVE AND BELOW THE GAP, so it cannot see
       a frame that is almost ENTIRELY white — and GIBS publishes those too: a
       GOES-East frame measured 92.6% pure white while reporting 100% opaque, and
       the whole hemisphere painted solid red because white decodes to -91.6C.
       This ceiling is the guard for that case. It is set far above anything
       weather produces: the most convective frame in the archive is 4% white, so
       50% is a factor of twelve of headroom and cannot fire on real cloud. */
    if (lit > 0 && white / lit > WHITE_CEIL) return true;

    if (mx < 50) return false;              /* nothing to judge */
    var thin = 0.15 * mx, top = -1, bot = -1;
    for (y = 0; y < h; y++) if (data[y] >= thin) { if (top < 0) top = y; bot = y; }
    if (top < 0 || bot - top < 10) return false;
    var run = 0;
    for (y = top; y <= bot; y++) {
      if (data[y] < thin) { run++; if (run >= SLAB_ROWS) return true; }
      else run = 0;
    }
    return false;
  }

  /* THE SEARCH FOR THE NEWEST FRAME IS DONE AT 64x32, NOT AT FULL SIZE. It used
     to walk back through full-size requests, so three unpublished frames cost
     three hemisphere-sized PNGs before anything could be drawn. The probe asks
     the same question for a few hundred bytes, and only the frame that answers
     is ever fetched properly.

     Probing at the SUB-POINT rather than in the requested box, because a valid
     frame is legitimately near-empty out at the limb, and that is indistinguish-
     able from one that has not been published. The full-size walk below is kept
     as the fallback for exactly that case.

     Both endpoints are walked at once and the newer answer wins. The walk starts
     at the CURRENT step, not one behind it: at full size that gamble cost a
     wasted hemisphere, and at 64x32 it costs nothing. */
  /* THE ANSWER IS A PROPERTY OF THE CLOCK, NOT OF THE VIEW, so it is cached and
     shared. Measured on a phone: a split view issued 7 probes for 5 satellites —
     one per JOB, so both halves of the dateline asked the same satellite the
     same question — and every pan asked all of them again from scratch. probe
     7186ms of a 7956ms render. The same device on an unsplit view, 976ms.

     Held for half a satellite step. Longer and a newly published frame would be
     missed; shorter and panning starts paying for it again. invalidate() drops
     the cache, so the five-minute refresh still asks properly. Concurrent
     callers share one in-flight request rather than racing to duplicate it. */
  var _probeCache = {};

  function probe(sat) {
    var rec = _probeCache[sat.id];
    if (rec && rec.pending) return rec.pending;
    if (rec && (Date.now() - rec.when) < sat.step * 30000) return Promise.resolve(rec.hit);

    var eps = sat.svc === 'gibs' ? GIBS_EP : [null];
    var step = sat.step * 60000;
    var box = { w: sat.lon - 10, e: sat.lon + 10, s: -5, n: 5 };
    var start = Math.floor(Date.now() / step) * step;

    /* ALL CANDIDATE TIMES AT ONCE, NOT ONE AFTER ANOTHER. Walking back a step at
       a time meant a round trip per unpublished frame before the real fetch
       could even begin, and GIBS routinely runs three or four steps behind:
       measured on a phone, probe 10673ms of an 11709ms fetch — 91% of it, while
       the imagery it was gating took 3782ms. The requests are 64x32 and both
       services are HTTP/2, so there is no six-connection wall to hit; issuing
       them together costs one round trip instead of four.

       Then take the NEWEST that answered, rather than the first — with the walk
       gone there is no "first", and newest is what was wanted all along. */
    function walk(ep) {
      var tries = [], k, t;
      for (k = 0; k < MAX_STEPS; k++) {
        t = start - k * step;
        if ((Date.now() - t) / 60000 > MAX_AGE_MIN) break;
        tries.push(t);
      }
      return Promise.all(tries.map(function (at) {
        return loadImage(url(sat, stamp(sat, at), box, 64, 32, ep)).then(function (im) {
          return hasPixels(readPixels(im, 64, 32)) ? at : 0;
        }, function () { return 0; });
      })).then(function (r) {
        var best = 0, i;
        for (i = 0; i < r.length; i++) if (r[i] > best) best = r[i];
        return best ? { at: best, ep: ep } : null;
      });
    }

    var _pt = Date.now();
    var p = Promise.all(eps.map(walk)).then(function (r) {
      if (Date.now() - _pt > _tProbe) _tProbe = Date.now() - _pt;
      var best = null, i;
      for (i = 0; i < r.length; i++) if (r[i] && (!best || r[i].at > best.at)) best = r[i];
      _probeCache[sat.id] = { hit: best, when: Date.now() };
      return best;
    }, function () { delete _probeCache[sat.id]; return null; });
    _probeCache[sat.id] = { pending: p };
    return p;
  }

  function frameFor(sat, box, w, h) {
    return probe(sat).then(function (hit) {
      var step = sat.step * 60000, n = 0;
      var ms = hit ? hit.at : Math.floor((Date.now() - step) / step) * step;
      var ep = hit ? hit.ep : null;
      var seen = _lastGood[sat.id];
      if (!hit && seen && (Date.now() - seen.at) < (sat.step + 1) * 60000) {
        ms = seen.at; ep = seen.ep;
      }

      /* HOW FAR THE FULL-SIZE WALK MAY GO. With no probe hit this is the old
         blind search. With a hit, that frame is known published — so a full-size
         request coming back empty means this satellite cannot see the requested
         box, which is geometry and does not improve by asking about earlier
         frames. Stepping back through MAX_STEPS hemisphere-sized PNGs to
         rediscover that a limb is a limb was the last slow path. Two attempts
         rather than one, because GIBS has been seen publishing the sub-point
         before the outer disc, so the frame immediately before earns one look. */
      var limit = hit ? 2 : MAX_STEPS;

      function attempt() {
        if (n >= limit) return null;
        var t = ms - (n++) * step;
        if ((Date.now() - t) / 60000 > MAX_AGE_MIN) return null;
        var iso = stamp(sat, t);
        return loadImage(url(sat, iso, box, w, h, ep)).then(function (im) {
          var d = readPixels(im, w, h);
          if (!hasPixels(d)) return attempt();
          if (partlyWritten(d, w, h)) return attempt();
          _lastGood[sat.id] = { at: t, ep: ep };
          return { iso: iso, at: t, d: d, sat: sat };
        }, attempt);
      }
      var _it = Date.now();
      return Promise.resolve().then(attempt).then(function (fr) {
        if (Date.now() - _it > _tImg) _tImg = Date.now() - _it;
        return fr;
      });
    });
  }

  /* ------------------------------------------------ step 1: temperature */

  /* 5-bit RGB cube into degrees C, built once: 32768 nearest-colour searches
     beats one per pixel per frame, and the map is exactly invertible so the
     nearest entry is the right entry. */
  function buildCube() {
    if (_cube) return;
    /* ONLY THE COLOURED ENTRIES GO IN THE CUBE. The map is a grey ramp for warm
       scenes and colours for tops colder than about -12C; a pixel that is
       coloured at all is therefore cold, by construction. Searching the whole
       table let a desaturated blend at a colour boundary land on a GREY entry,
       and grey entries are all warm — measured, coloured pixels decoding as high
       as +39C, which turned the coldest storm cores into clear sky and punched
       white holes through the middle of them. */
    _cube = new Float32Array(32768);
    for (var r = 0; r < 32; r++) for (var g = 0; g < 32; g++) for (var b = 0; b < 32; b++) {
      var R8 = r * 8 + 4, G8 = g * 8 + 4, B8 = b * 8 + 4, bi = -1, bd = 1e9, k, c, d;
      for (k = 0; k < CMAP.length; k++) {
        c = CMAP[k];
        if (c[3] >= -11.5) continue;
        d = (c[0] - R8) * (c[0] - R8) + (c[1] - G8) * (c[1] - G8) + (c[2] - B8) * (c[2] - B8);
        if (d < bd) { bd = d; bi = k; }
      }
      _cube[(r << 10) | (g << 5) | b] = bi < 0 ? -11.5 : CMAP[bi][3];
    }
  }

  /* GIBS's rendering is a GREY RAMP WITH A COLOURED COLD SECTION, and the
     published map only tabulates the grey ramp as far as 179. GOES routinely
     sends greys up to 197, and nearest-colour matching those against a table
     that stops at 179 returns nonsense: grey 190 decoded to +54C, grey 182 to
     -64C. The very coldest greys therefore came back HOTTER than the ground,
     which both erased real cloud and poisoned the warmest-is-ground reference
     that every other pixel is measured against.
     The tabulated grey ramp is linear to within 0.24C over its 138 entries, so
     greys are decoded from that line and extrapolated past its end, and only
     genuinely coloured pixels go through the cube. */
  var GREY_A = -0.38598, GREY_B = 57.2375;

  function tempOf(sat, d, p) {
    if (sat.temp === 'cmap') {
      var r = d[p], g2 = d[p + 1], b2 = d[p + 2];
      /* Saturation, not channel differences: antialiasing between two greys
         leaves a slightly tinted pixel that is still grey in meaning. */
      var mx = r > g2 ? (r > b2 ? r : b2) : (g2 > b2 ? g2 : b2);
      var mn = r < g2 ? (r < b2 ? r : b2) : (g2 < b2 ? g2 : b2);
      if (mx - mn <= 12) return GREY_A * ((r + g2 + b2) / 3) + GREY_B;
      return _cube[((r >> 3) << 10) | ((g2 >> 3) << 5) | (b2 >> 3)];
    }
    var g = (d[p] + d[p + 1] + d[p + 2]) / 3;
    return EUM_T[sat.temp][g < 0 ? 0 : g > 255 ? 255 : g | 0];
  }

  /* ------------------------------------------------ step 2: surface field */

  /* THE CLEAR-SKY BACKGROUND IS A PROPERTY OF THE GROUND, NOT OF THE VIEWPORT.
     Keyed to the view box it was refetched on every pan — four extra frames per
     satellite per half, which is where a minute of loading went — and a
     background cached from a wide view was then point-sampled by a zoomed-in
     frame, which is where the blocks came from.
     So: one fixed grid per satellite, over that satellite's own useful span,
     fetched once per BG_TTL and read by longitude and latitude. Panning and
     zooming cost nothing. */
  var _bg = {};
  var BG_W = 1024;   /* 0.35 deg — matched to the imagery, not to a guess */

  /* THE WHOLE WORLD, ALWAYS. Sized to the satellite it wrapped past 180 for
     Himawari and both GOES, and the wrap fallback then requested the world at
     the SAME pixel width — so three of five satellites measured cloud against a
     clear-sky field four times coarser than their own imagery. That is where the
     blockiness came from, and the missing slices were its off-disc gaps. One
     fixed world grid has no wrap case to get wrong. */
  function bgBox() {
    return { w: -180, e: 180, s: -70, n: 70 };
  }

  function background(sat) {
    var have = _bg[sat.id];
    if (have && (Date.now() - have.at) < BG_TTL) return Promise.resolve(have);
    if (have && have.pending) return have.pending;
    var box = bgBox();
    var bw = BG_W, bh = Math.round(BG_W * (mercY(box.n) - mercY(box.s)) /
                                   (R * (box.e - box.w) * Math.PI / 180));
    /* The four frames are independent of one another, so they are fetched
       together. Sequentially they were four round trips per satellite before
       anything could be drawn — twenty seconds on a cold start. */
    var reqs = [], n;
    for (n = 0; n < BG_FRAMES; n++) {
      var ms = Date.now() - n * BG_GAP_MIN * 60000 - sat.step * 60000;
      ms = Math.floor(ms / (sat.step * 60000)) * (sat.step * 60000);
      reqs.push(loadImage(url(sat, stamp(sat, ms), box, bw, bh))
        .then(function (im) { return readPixels(im, bw, bh); }, function () { return null; }));
    }

    var pending = Promise.all(reqs).then(function (frames) {
      var best = null, second = null, i, p, t, fi, d;
      for (fi = 0; fi < frames.length; fi++) {
        d = frames[fi];
        if (!d) continue;
        if (!best) {
          best = new Float32Array(bw * bh); second = new Float32Array(bw * bh);
          for (i = 0; i < best.length; i++) { best[i] = -999; second[i] = -999; }
        }
        /* Second warmest, not warmest: one hot outlier or bad scan line would
           otherwise set a pixel's clear-sky value for the whole cache period.
           This is what the published composites use. */
        for (i = 0, p = 0; i < bw * bh; i++, p += 4) {
          if (d[p + 3] < 250) continue;
          t = tempOf(sat, d, p);
          if (t > best[i]) { second[i] = best[i]; best[i] = t; }
          else if (t > second[i]) second[i] = t;
        }
      }
      if (!best) return null;
      for (i = 0; i < best.length; i++) if (second[i] < -900) second[i] = best[i];
      var rec = { at: Date.now(), w: bw, h: bh, T: second, box: box };
      _bg[sat.id] = rec;
      return rec;
    });
    _bg[sat.id] = { at: 0, pending: pending };
    return pending;
  }

  /* Bilinear, by geography. Point sampling a coarser grid is what made the field
     look like blocks. */
  /* bgAt WAS 89% OF THE ENTIRE RENDER. Stubbing it out took a Pacific composite
     from 6.6s to 0.7s, which is where the fifteen seconds on a phone were going
     — not the network, which had already been fixed. The cost is not the
     bilinear read; it is that mercY(bg.box.n), mercY(bg.box.s) and mercY(lat)
     were recomputed on every one of 1.3 million calls, and mercY is a log of a
     tan. Three transcendentals per pixel per satellite.

     None of it varies per pixel. The two box edges are constant, and the third
     depends only on the ROW. Every background is on the same world grid at the
     same size (§3.3), so a single set of tables serves every satellite: for each
     column the two source columns and the fraction between them, for each row
     the same. Built once per compose, keyed on the grid's geometry so that
     changing the background box later cannot silently reuse the wrong table. */

  function bgKey(bg) {
    return bg.w + ':' + bg.h + ':' + bg.box.w + ':' + bg.box.e + ':' + bg.box.s + ':' + bg.box.n;
  }

  function bgTables(bg, lonOf, latOf) {
    var w = lonOf.length, h = latOf.length, i, j, u, v, a, b;
    var x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float64Array(w);
    var y0 = new Int32Array(h), y1 = new Int32Array(h), ty = new Float64Array(h);
    var colOK = new Uint8Array(w), rowOK = new Uint8Array(h);
    var span = bg.box.e - bg.box.w, yN = mercY(bg.box.n), yS = mercY(bg.box.s);
    for (i = 0; i < w; i++) {
      u = (((lonOf[i] - bg.box.w) % 360 + 360) % 360) / span * bg.w - 0.5;
      a = Math.floor(u); tx[i] = u - a; b = a + 1;
      x0[i] = a < 0 ? 0 : (a > bg.w - 1 ? bg.w - 1 : a);
      x1[i] = b > bg.w - 1 ? bg.w - 1 : b;
      colOK[i] = x1[i] >= 0 ? 1 : 0;
    }
    for (j = 0; j < h; j++) {
      v = (yN - mercY(latOf[j])) / (yN - yS) * bg.h - 0.5;
      a = Math.floor(v); ty[j] = v - a; b = a + 1;
      y0[j] = a < 0 ? 0 : (a > bg.h - 1 ? bg.h - 1 : a);
      y1[j] = b > bg.h - 1 ? bg.h - 1 : b;
      /* SYMMETRIC NOW. The far index going negative already stopped anything
         being drawn north of the grid. The south end did the opposite: it
         clamped onto the last row, so every pixel below 70S was measured
         against the clear-sky temperature at 70S — far warmer than the ice
         beneath it — which reported a huge depression and painted Antarctica
         solid, streaked by the limb-stretched imagery it was reading. Same rule
         at both ends: outside the grid there is no reference, so nothing is
         measured and nothing is drawn. The half-pixel tolerance matches the
         north's, so views that only reach past 70N are unaffected. */
      rowOK[j] = (b >= 0 && a <= bg.h - 1) ? 1 : 0;
    }
    /* The far index is deliberately NOT clamped up from below, because bgAt was
       not either: a view reaching past the grid's northern edge — it stops at
       70° and the canvas can show 73° — drove that index negative, which read as
       undefined and propagated NaN, and a NaN pixel fell out of the draw test
       and was left alone. So beyond the grid nothing is measured and nothing is
       drawn, which is the right answer anyway: there is no clear-sky reference
       up there to compare against, and inventing one by clamping onto the last
       row would paint the Arctic from a 70° proxy. Rows where it happens are
       flagged here instead, so the inner loop can skip them without arithmetic
       on an out-of-range index. Note the south edge behaves differently — it
       clamps and extrapolates. That asymmetry is inherited, not chosen. */
    return { x0: x0, x1: x1, tx: tx, y0: y0, y1: y1, ty: ty,
             colOK: colOK, rowOK: rowOK };
  }

  /* Kept as the reference the tables must agree with, and as the fallback for
     any caller that is not the inner loop. */
  function bgAt(bg, lon, lat) {
    var u = (((lon - bg.box.w) % 360 + 360) % 360) / (bg.box.e - bg.box.w) * bg.w - 0.5;
    var v = (mercY(bg.box.n) - mercY(lat)) / (mercY(bg.box.n) - mercY(bg.box.s)) * bg.h - 0.5;
    var x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > bg.w - 1) x1 = bg.w - 1; if (y1 > bg.h - 1) y1 = bg.h - 1;
    if (x0 > bg.w - 1) x0 = bg.w - 1; if (y0 > bg.h - 1) y0 = bg.h - 1;
    var a0 = bg.T[y0 * bg.w + x0], a1 = bg.T[y0 * bg.w + x1];
    var b0 = bg.T[y1 * bg.w + x0], b1 = bg.T[y1 * bg.w + x1];
    if (a0 < -900 || a1 < -900 || b0 < -900 || b1 < -900) return -999;
    return (a0 * (1 - tx) + a1 * tx) * (1 - ty) + (b0 * (1 - tx) + b1 * tx) * ty;
  }

  /* ------------------------------------------------ step 4: geometry */

  function weightAt(sat, lon, lat) {
    var d = Math.abs(((lon - sat.lon + 540) % 360) - 180) * Math.PI / 180;
    var c = Math.cos(lat * Math.PI / 180) * Math.cos(d) - CUT;
    return c > 0 ? c * c * c : 0;
  }

  /* Descending weight until what is left out carries less than TAIL of the
     total. Fetching a satellite that contributes 0.0006 — GOES-East seen from
     Spain — cost a request and could not change the answer. */
  function chooseSats(box) {
    var w = [], i, s, m, lon, lat,
        dl = Math.max(1, (box.e - box.w) / 6), dt = Math.max(1, (box.n - box.s) / 6);
    for (i = 0; i < SATS.length; i++) {
      s = SATS[i]; m = 0;
      for (lon = box.w; lon <= box.e + 1e-9; lon += dl)
        for (lat = box.s; lat <= box.n + 1e-9; lat += dt)
          m = Math.max(m, weightAt(s, lon, lat));
      w.push({ sat: SATS[i], w: m });
    }
    w.sort(function (a, b) { return b.w - a.w; });
    var total = 0;
    for (i = 0; i < w.length; i++) total += w[i].w;
    var kept = [], acc = 0;
    for (i = 0; i < w.length; i++) {
      if (w[i].w <= 0) break;
      kept.push(w[i].sat); acc += w[i].w;
      if (total - acc <= total * TAIL) break;
    }
    return kept;
  }

  /* ------------------------------------------------ step 3: rendering */

  /* Colour is cloud-top height. Red because every basemap renders water blue and
     most of what this layer covers is ocean; white vanished on the near-white
     street and topographic maps. */
  function buildPalette() {
    if (_lut) return;
    var S = [[0.00, 252, 216, 206], [0.50, 238, 158, 138], [1.00, 198, 74, 58]];
    var lut = new Uint8Array(256 * 3), v, q, i, k, n, t;
    for (v = 0; v < 256; v++) {
      q = v / 255;
      for (i = 1; i < S.length && S[i][0] < q; i++) {}
      k = S[i - 1]; n = S[Math.min(i, S.length - 1)];
      t = (n[0] === k[0]) ? 0 : (q - k[0]) / (n[0] - k[0]);
      lut[v * 3] = k[1] + (n[1] - k[1]) * t;
      lut[v * 3 + 1] = k[2] + (n[2] - k[2]) * t;
      lut[v * 3 + 2] = k[3] + (n[3] - k[3]) * t;
    }
    _lut = lut;
  }

  function compose(box, w, h, frames) {
    var _bgTab = {};
    var dTsum = new Float32Array(w * h), wsum = new Float32Array(w * h);
    var si, fr, sat, d, i, j, q, p, wt, lat, lon, pw, pbox, n2, dT;
    var yTop = mercY(box.n), yBot = mercY(box.s);
    var lats = new Float64Array(h), wts = new Float64Array(w), srcX = new Int32Array(w);
    var lonOf = new Float64Array(w), latOf = new Float64Array(h), bgT;
    for (j = 0; j < h; j++) {
      latOf[j] = invMercY(yTop - (j + 0.5) / h * (yTop - yBot));
      lats[j] = Math.cos(latOf[j] * Math.PI / 180);
    }
    for (i = 0; i < w; i++) lonOf[i] = box.w + (i + 0.5) / w * (box.e - box.w);

    for (si = 0; si < frames.length; si++) {
      fr = frames[si];
      if (!fr) continue;
      sat = fr.sat; d = fr.d; pbox = fr.box; pw = fr.pw;

      var T = new Float32Array(pw * h), ok = new Uint8Array(pw * h);
      for (n2 = 0; n2 < pw * h; n2++) {
        p = n2 * 4;
        if (d[p + 3] < 250) continue;
        T[n2] = tempOf(sat, d, p); ok[n2] = 1;
      }
      /* The clear-sky background is ALREADY per pixel; nothing spatial belongs on
         top of it. An intermediate version took the temporal maximum, then the
         warmest tenth of a cell, then the warmest neighbouring cell — warmest of
         warmest of warmest — and painted 81% of the United States against a
         visible band saying 20%. With the background used directly: 22%. */
      var bg = fr.bg;
      var bk = bgKey(bg);
      if (!_bgTab[bk]) _bgTab[bk] = bgTables(bg, lonOf, latOf);
      var tb = _bgTab[bk], bx0 = tb.x0, bx1 = tb.x1, btx = tb.tx;

      /* Placed by GEOGRAPHY. Blitting frames into pixel ranges left columns that
         nothing wrote to where two ranges met — a clear band down the Pacific,
         a seam in the compositing rather than a gap in the sky. */
      var span = pbox.e - pbox.w, rel;
      for (i = 0; i < w; i++) {
        lon = box.w + (i + 0.5) / w * (box.e - box.w);
        rel = lon - pbox.w; rel -= Math.floor(rel / 360) * 360;
        if (rel < 0 || rel >= span) { srcX[i] = -1; continue; }
        srcX[i] = Math.min(pw - 1, (rel / span * pw) | 0);
        wts[i] = Math.cos(Math.abs(((lon - sat.lon + 540) % 360) - 180) * Math.PI / 180);
      }

      for (j = 0; j < h; j++) {
        lat = lats[j];
        if (!tb.rowOK[j]) continue;
        var r0 = tb.y0[j] * bg.w, r1 = tb.y1[j] * bg.w, ty = tb.ty[j], tx1;
        var a0, a1, c0, c1;
        for (i = 0; i < w; i++) {
          if (srcX[i] < 0 || !tb.colOK[i]) continue;
          n2 = j * pw + srcX[i];
          if (!ok[n2]) continue;
          wt = lat * wts[i] - CUT;
          if (wt <= 0) continue;
          wt = wt * wt * wt;
          q = j * w + i;
          a0 = bg.T[r0 + bx0[i]]; a1 = bg.T[r0 + bx1[i]];
          c0 = bg.T[r1 + bx0[i]]; c1 = bg.T[r1 + bx1[i]];
          /* -999 means one of the four neighbours has no clear-sky value, so
             there is no depression to measure here and the pixel is left alone.
             ANY missing neighbour disqualifies it, exactly as bgAt did. */
          if (a0 < -900 || a1 < -900 || c0 < -900 || c1 < -900) continue;
          tx1 = btx[i];
          bgT = (a0 * (1 - tx1) + a1 * tx1) * (1 - ty) + (c0 * (1 - tx1) + c1 * tx1) * ty;
          dTsum[q] += wt * (bgT - T[n2]);
          wsum[q] += wt;
        }
      }
    }

    var img = _ctx.createImageData(w, h), o = img.data, k, litpx = 0, npx = 0, prob;
    for (q = 0, p = 0; q < w * h; q++, p += 4) {
      if (wsum[q] <= 0) continue;
      dT = dTsum[q] / wsum[q];
      prob = 1 / (1 + Math.exp(-(dT - P_MID) / P_WIDTH));
      /* DRAWN ONLY WHERE CLOUD IS MORE LIKELY THAN NOT. Drawing every pixel
         whose probability is merely non-zero asserts cloud over sky that is
         most likely clear, and measured on a real Pacific view it painted 96.8%
         of the canvas — the wash that made the map useless. At one half, 66.4%
         is painted, which is the observed global cloud fraction. Half is not a
         tuned number: it is the point where the claim becomes true more often
         than false. */
      if (prob < P_DRAW) continue;
      k = Math.max(0, Math.min(255, (dT / T_FULL * 255) | 0));
      o[p] = _lut[k * 3]; o[p + 1] = _lut[k * 3 + 1]; o[p + 2] = _lut[k * 3 + 2];
      o[p + 3] = 255 * prob;
    }
    for (p = 3; p < o.length; p += 4 * 97) { npx++; if (o[p] > 0) litpx++; }
    _painted = npx ? litpx / npx : 0;
    /* Sized here, not in render() — see the note there. This clears the canvas,
       so it must happen with the replacement pixels already in hand. */
    if (_cv) {
      if (_cv.width !== w) _cv.width = w;
      if (_cv.height !== h) _cv.height = h;
    }
    _ctx.putImageData(img, 0, 0);
  }

  /* ------------------------------------------------------------ the pass */

  function render() {
    var _t0 = Date.now();
    _tProbe = 0; _tImg = 0; _tBg = 0; _tDecode = 0;
    var box = viewBox(), el = _map.getCanvas();
    var aspect = (mercY(box.n) - mercY(box.s)) / (R * (box.e - box.w) * Math.PI / 180);
    var w = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(el.width)));
    var h = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(w * aspect)));
    var wh = safeSize(w, h); w = wh[0]; h = wh[1];
    if (!_cv) { _cv = document.createElement('canvas'); _ctx = _cv.getContext('2d'); }
    /* THE CANVAS IS NOT RESIZED HERE. Assigning width or height to a canvas
       CLEARS it, and MapLibre's source is reading from this very canvas — so
       resizing at the top of a render wiped the cloud off the map the instant a
       pan began, and left it blank for the whole fetch. That is the layer
       vanishing for six to fifteen seconds on every pan and zoom. The size is
       applied in compose(), immediately before the new pixels are written, so
       the previous frame stays on screen until there is something to replace it
       with. It will be stretched slightly against the new view until then,
       which is what every map does while tiles load, and is enormously better
       than nothing. */

    /* No WMS serves longitude past 180, so a view straddling the dateline is two
       requests. Frames are placed by longitude, so the halves need not tile.

       The western half is inset by ONE CANVAS PIXEL and never asks for exactly
       -180. Measured: with a bbox whose west edge is at or beyond -179.92, GIBS
       returns the leftmost ~10% of the image blank — 49 of 494 columns for
       GOES-West, the same 10% at 247, 494 and 988 px wide, and the same again
       from -185. That was the vertical stripe down the dateline. The geometry
       of the reply is otherwise correct (cross-correlation against an inset
       request gives a best shift of 0 px), so nothing downstream was at fault:
       not bgAt, not srcX. Insetting by one pixel clears it at every resolution
       tested. One pixel rather than a fixed angle because the threshold scales
       with the request; the cost is the half-pixel column at the seam.

       BOTH EDGES, and the first fix only did the western one. The east edge at
       exactly +180 loses the same ~10%: measured on this very view, a Himawari
       request for -30..180 at 672 px wide returned data only to column 604 — 67
       columns dropped — and inset by one pixel it returned all 672. That was a
       second dateline gap, wider than the first and further west, sitting inside
       the EASTERN half where nobody was looking for it. */
    var parts = [], eps = (box.e - box.w) / w;
    if (box.e > 180) {
      parts.push({ w: box.w, e: 180 - eps, s: box.s, n: box.n });
      parts.push({ w: -180 + eps, e: box.e - 360, s: box.s, n: box.n });
    } else if (box.w < -180) {
      parts.push({ w: box.w + 360, e: 180 - eps, s: box.s, n: box.n });
      parts.push({ w: -180 + eps, e: box.e, s: box.s, n: box.n });
    } else parts.push(box);

    /* Satellites are chosen PER PART, not per view. Chosen for the whole box, a
       view spanning the Pacific asked Meteosat for the far side of the world and
       GOES-East for the western Pacific: those requests return an empty image,
       which is indistinguishable from a not-yet-published frame, so each one
       burned the full step-back retry before giving up. Measured on one Pacific
       view: 45 requests, 32 of them for satellites that physically cannot see
       the half they were asked about. */
    var jobs = [], i, pi, sats = [], seenSat = {};
    for (pi = 0; pi < parts.length; pi++) {
      var ps = chooseSats(parts[pi]);
      for (i = 0; i < ps.length; i++) {
        jobs.push({ sat: ps[i], box: parts[pi] });
        if (!seenSat[ps[i].id]) { seenSat[ps[i].id] = 1; sats.push(ps[i]); }
      }
    }

    /* Every satellite's background is started at once, before any imagery is
       fetched: they are independent, they are cached for half an hour, and
       waiting for them one satellite at a time was most of a cold start.
       They are STARTED here, not waited for: each job awaits its own satellite's
       background, so gating the imagery behind Promise.all(warm) only added the
       slowest background to the front of every fetch. */
    for (i = 0; i < sats.length; i++) background(sats[i]);

    /* IN PARALLEL, indexed rather than pushed so the order is still the job
       order. This was a sequential chain on the grounds that several full-size
       PNGs in flight is a lot of memory on a phone — but compose() needs every
       frame's pixels at once, so out[] holds them all either way and the chain
       bought no memory at all. It cost the sum of the requests instead of the
       slowest: measured on the real eight-job Pacific view, 5.9s sequential
       against 1.0s parallel. */
    var out = new Array(jobs.length), runs = [];

    function run(job, idx) {
      var pw = Math.max(64, Math.round((job.box.e - job.box.w) / (box.e - box.w) * w));
      return frameFor(job.sat, job.box, pw, h).then(function (fr) {
        if (!fr) { out[idx] = null; return; }
        fr.box = job.box; fr.pw = pw;
        var _bt = Date.now();
        return background(job.sat).then(function (bg) {
          if (Date.now() - _bt > _tBg) _tBg = Date.now() - _bt;
          /* WITHOUT A CLEAR-SKY BACKGROUND THERE IS NO DEPRESSION TO MEASURE, so
             this satellite has no answer to give and is reported missing rather
             than drawn as empty sky. Blank reads as CLEAR on this map, and that
             is the one thing it must never say by accident. */
          if (!bg) { out[idx] = null; return; }
          fr.bg = bg; out[idx] = fr;
        }, function () { out[idx] = null; });
      }, function () { out[idx] = null; });
    }

    for (i = 0; i < jobs.length; i++) runs.push(run(jobs[i], i));

    return Promise.all(runs).then(function () {
      _timing.fetch = Date.now() - _t0;
      _timing.probe = _tProbe; _timing.img = _tImg;
      _timing.bg = _tBg; _timing.decode = _tDecode;
      var frames = out;
      var stamps = [], any = false, k, seen = {};
      for (k = 0; k < frames.length; k++) {
        if (!frames[k]) continue;
        any = true;
        if (seen[frames[k].sat.id]) continue;
        seen[frames[k].sat.id] = 1;
        stamps.push({ id: frames[k].sat.id, name: frames[k].sat.name,
                      iso: frames[k].iso, at: frames[k].at });
      }
      _missing = sats.filter(function (s) { return !seen[s.id]; })
                     .map(function (s) { return s.name; });
      if (!any) { _err = 'no satellite frames available'; return false; }
      /* off() may have fired while these were in the air; without this the pass
         puts the layer back on a map the user has just switched away from. */
      if (!_on) return false;
      _stamps = stamps;
      /* WHERE THE TIME ACTUALLY GOES, reported by diagnose() rather than
         guessed at from a description. Every performance claim in this file that
         turned out to be wrong was reasoned from the shape of the code; every
         one that held up came from a number. fetch covers network, decode and
         readPixels together — if it dominates, split it before touching it. */
      var _tc = Date.now();
      compose(box, w, h, frames);
      _timing.compose = Date.now() - _tc;
      var _tp = Date.now();
      place(box);
      _timing.place = Date.now() - _tp;
      _timing.total = Date.now() - _t0;
      _timing.frames = frames.length;
      _timing.px = w + 'x' + h;
      _drawn = box; _drawnZoom = _map.getZoom(); _at = Date.now();
      return true;
    });
  }

  /* A CANVAS SOURCE, not an image source: an image source has to re-fetch and
     re-decode a data URL before anything appears, and was measured here producing
     a correct canvas and a blank map. animate:false means prepare() only
     re-uploads on resize or while playing, so play() then pause() forces exactly
     one upload. Do not simplify that pair away. */
  function place(box) {
    var c = [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
    if (_map.getSource(SRC)) { _src.setCoordinates(c); _src.play(); _src.pause(); }
    else {
      _map.addSource(SRC, { type: 'canvas', canvas: _cv, coordinates: c,
                            animate: false, attribution: CREDIT });
      /* Top of the stack: online basemap rasters are pushed above the whole
         vector stack, so anything below them is invisible whenever a basemap is
         selected. deck.gl draws the path and shadow above all MapLibre layers. */
      _map.addLayer({ id: LAYER, type: 'raster', source: SRC,
                      paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 } });
      _src = _map.getSource(SRC);
    }
    try { _map.setLayoutProperty(LAYER, 'visibility', 'visible'); } catch (e) {}
  }

  function removeLayer() {
    if (!_map) return;
    try { if (_map.getLayer(LAYER)) _map.removeLayer(LAYER); } catch (e) {}
    try { if (_map.getSource(SRC)) _map.removeSource(SRC); } catch (e) {}
    _src = null; _drawn = null;
  }

  /* --------------------------------------------------------------- public */

  function announce() {
    for (var i = 0; i < _listeners.length; i++) { try { _listeners[i](); } catch (e) {} }
  }

  function refresh(force) {
    if (!_on || !_map) return Promise.resolve(false);
    if (_busy) { _again = true; return Promise.resolve(true); }
    if (!force && covered() && (Date.now() - _at) < TTL) return Promise.resolve(true);
    buildPalette(); buildCube();
    _busy = true; _err = null;
    return render().then(function (ok) {
      _busy = false; announce();
      if (_again) { _again = false; return refresh(false); }
      return ok;
    }, function (e) {
      _busy = false; _err = String(e); announce();
      if (_again) { _again = false; return refresh(false); }
      return false;
    });
  }

  /* Debounced: a pinch fires moveend repeatedly and each one used to start a
     round of requests the next immediately superseded. */
  function onMoveEnd() {
    if (!_on) return;
    if (_pending) clearTimeout(_pending);
    _pending = setTimeout(function () { _pending = null; refresh(false); }, 200);
  }

  /* NO TIMER HERE. cloudbar.js has owned the refresh loop all along — a 5-minute
     interval calling invalidate(). A timer was briefly added here as well, on
     the strength of grepping this file alone and concluding the feature never
     refreshed. It did. Two loops on different periods is worse than one, and the
     one that already existed clears _drawn first, which this would not have. */
  function on(map) {
    _map = map; _on = true;
    _map.on('moveend', onMoveEnd);
    return refresh(true);
  }

  function off() {
    _on = false; _stamps = []; _at = 0; _again = false;
    if (_pending) { clearTimeout(_pending); _pending = null; }
    if (_map) _map.off('moveend', onMoveEnd);
    removeLayer();
  }

  function isOn() { return _on; }
  function onFrame(fn) { if (typeof fn === 'function') _listeners.push(fn); }
  function missing() { return _missing.slice(); }

  function invalidate() {
    if (_busy) return Promise.resolve(false);
    /* The cached newest-frame answers go too. This is the call the five-minute
       refresh makes, and its whole purpose is to find a frame newer than the one
       on screen — reusing a cached answer would make it a no-op. */
    _probeCache = {};
    _at = 0; _drawn = null;
    return refresh(true).then(function (v) { return v; }, function () { return false; });
  }

  /* Needs the LATITUDE as well as the longitude: the ring covers every longitude
     but runs out of sky toward the poles. */
  function coverage(lon, lat) {
    for (var i = 0; i < SATS.length; i++) if (weightAt(SATS[i], lon, lat || 0) > 0) return { ok: true };
    return { ok: false, reason: Math.abs(lat || 0) > 60 ? 'too-far-north' : 'no-satellite' };
  }

  /* The age of what you are LOOKING AT: reporting the oldest frame globally made
     Himawari, half an hour behind, label a European track. */
  function shownTime() {
    if (!_stamps.length) return null;
    var c = null, i, k, sat, best = null, bw = -1, w;
    try { c = _map && _map.getCenter(); } catch (e) { c = null; }
    if (c) {
      for (i = 0; i < _stamps.length; i++) {
        sat = null;
        for (k = 0; k < SATS.length; k++) if (SATS[k].id === _stamps[i].id) sat = SATS[k];
        if (!sat) continue;
        w = weightAt(sat, c.lng, c.lat);
        if (w > bw) { bw = w; best = _stamps[i]; }
      }
      if (best && bw > 0) return best.iso;
    }
    var t = _stamps[0];
    for (i = 1; i < _stamps.length; i++) if (_stamps[i].at < t.at) t = _stamps[i];
    return t.iso;
  }

  /* Infrared works after dark, which is why it is here rather than a visible
     band: the drive is often decided at 3 a.m. */
  function hasNight() { return true; }

  window.Satellite = {
    version: '2026-08-19d',
    CREDIT: CREDIT,
    on: on, off: off, isOn: isOn, refresh: refresh,
    onFrame: onFrame, missing: missing, invalidate: invalidate,
    coverage: coverage, shownTime: shownTime, hasNight: hasNight,
    frames: function () { return _stamps.slice(); },
    error: function () { return _err; },
    diagnose: function () {
      return { timing: _timing,
               painted: _painted, frames: _stamps.length, missing: _missing.slice(),
               drawn: _drawn, busy: _busy,
               layer: !!(_map && _map.getLayer(LAYER)),
               source: !!(_map && _map.getSource(SRC)), error: _err };
    },
    _sats: function () { return SATS.slice(); },
    _weightAt: weightAt,
    _cmap: function () { return CMAP; },
    _eumT: function () { return EUM_T; },
    _url: url,
    _viewBox: function (m) { return viewBox(m); }
  };
})();
