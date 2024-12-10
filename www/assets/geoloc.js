function geo_distance(pos1, pos2) {
    if ((pos1.coords.latitude == pos2.coords.latitude) && (pos1.coords.longitude == pos2.coords.longitude)) {
        return 0;
    }
    else {
        var radLat1 = Math.PI * pos1.coords.latitude/180;
        var radLat2 = Math.PI * pos2.coords.latitude/180;
        var theta = pos1.coords.longitude-pos2.coords.longitude;
        var radtheta = Math.PI * theta/180;
        var dist = Math.sin(radLat1) * Math.sin(radLat2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180/Math.PI;
        dist = dist * 60 * 1.1515 * 1.609344 * 1000
        return dist;
    }
}