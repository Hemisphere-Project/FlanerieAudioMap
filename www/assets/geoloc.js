function geo_distance(pos1, pos2) 
{
    // convert coords to array
    if (pos1.coords) pos1 = [pos1.coords.latitude, pos1.coords.longitude]
    if (pos1.lat) pos1 = [pos1.lat, pos1.lng]
    if (pos2.coords) pos2 = [pos2.coords.latitude, pos2.coords.longitude]
    if (pos2.lat) pos2 = [pos2.lat, pos2.lng]

    if ((pos1[0] == pos2[0]) && (pos1[1] == pos2[1])) {
        return 0;
    }
    else {
        var radlat1 = Math.PI * pos1[0]/180
        var radlat2 = Math.PI * pos2[0]/180
        var theta = pos1[1]-pos2[1]
        var radtheta = Math.PI * theta/180
        var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
        if (dist > 1) dist = 1
        dist = Math.acos(dist)
        dist = dist * 180/Math.PI
        dist = dist * 60 * 1.1515 * 1.609344 * 1000
        return dist
    }
}

// Shortest distance in meters from a point to a segment,
// where a segment is defined by two points.
// pos is the point, segA and segB are the two points defining the segment.
// All points are in the form [lat, lng].
function geo_distance_to_segment(pos, segA, segB) 
{
    // convert coords to array
    if (pos.coords) pos = [pos.coords.latitude, pos.coords.longitude]
    if (pos.lat) pos = [pos.lat, pos.lng]
    if (segA.coords) segA = [segA.coords.latitude, segA.coords.longitude]
    if (segA.lat) segA = [segA.lat, segA.lng]
    if (segB.coords) segB = [segB.coords.latitude, segB.coords.longitude]
    if (segB.lat) segB = [segB.lat, segB.lng]

    var a = pos[0] - segA[0]
    var b = pos[1] - segA[1]
    var c = segB[0] - segA[0]
    var d = segB[1] - segA[1]

    var dot = a * c + b * d
    var len_sq = c * c + d * d
    var param = -1
    if (len_sq != 0) // in case of 0 length line
        param = dot / len_sq

    var xx, yy

    if (param < 0) {
        xx = segA[0]
        yy = segA[1]
    }
    else if (param > 1) {
        xx = segB[0]
        yy = segB[1]
    }
    else {
        xx = segA[0] + param * c
        yy = segA[1] + param * d
    }

    return geo_distance(pos, [xx, yy])
}
