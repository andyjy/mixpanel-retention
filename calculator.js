// from https://mixpanel.com/labs/split-test-calculator

var calculator = {
    // Use a two-proportion z-test to determine
    // whether one of the values in a split test is greater
    // than the other.
    zscore : function(values) {
        // Calculate z score for a/b test
        if (values.length == 2) {
            // v = visitors, g = goals
            var g0 = values[0].goals,
            g1= values[1].goals,
            v0 = values[0].visitors,
            v1 = values[1].visitors,
            cr0 = g0/v0,
            cr1 = g1/v1;
            
            var p = (g0 + g1) / (v0 + v1);

            var sp = Math.sqrt(p * (1 - p) * (1/v0 + 1/v1));

            return (cr0 - cr1)/sp;
            
        }
        else {
            return null;
        }
    },
    pvalue : function(zscore) {
        if (zscore === null) { return null; }
        var Z_TABLE = [[0.30, 0.53], [0.20, 0.85], [0.10, 1.29], [0.05, 1.65], [0.01, 2.33], [0.001, 3.08]];

        var found_p = 1;
        for (var z in Z_TABLE) {
            if (z) {
                if (Math.abs(zscore) >= Z_TABLE[z][1]) {
                    found_p = Z_TABLE[z][0];
                }
            }
        }
        var version = (zscore <= 0) ? 1 : 0;
        
        return $.extend(this.values[version], { p: found_p });
    },
    confidence : function(values) {
        this.values = values;
        return this.pvalue(this.zscore(values));
    }
};

var competition = function(treatments) {
    /*  Here we pit each version against the others, repeatedly setting 
        the version with the lowest conversion rate as the control.
        
        It will the single best version if it exists, and if there is no 
        single version it will show the ones that are significantly *worse*
        than the others.
    */
    var test_results = {};
    var max_p = 0.2;
    var run_trials = function(treatments) {
        var control = treatments[0];
        var to_test = treatments.slice(1);
        var saved = [];
        for (var i in to_test) {
            if (!isNaN(parseInt(i, 10))) {
                if (!test_results[control.name]) { test_results[control.name] = []; }
                var result = calculator.confidence([control, to_test[i]]);
                if (result.p <= max_p) {
                    saved.push(result);
                }
                test_results[control.name].push({'winner': result.name, 'p': result.p, 'vs': to_test[i].name, 'conv': result.goals / result.visitors});
                
            }                    

        }

        if (saved.length <= 1) {
            return {winners: saved, competitors: treatments};
        } else {
            return run_trials(saved);
        }
    };
    
    var results = run_trials(treatments);
    results.test_results = test_results;
    return results;
};

var resultset = {
    adjectives: {
        0.30: 'moderately confident',
        0.20: 'fairly confident',
        0.10: 'quite confident',
        0.05: 'very confident',
        0.01: 'extremely confident',
        0.001: 'certain'
    },
    worst: function(result) {
        // No winners: all treatments passed in are equiv.
        // Means we can highlight the *not* passed in ones,
        // since they lost previously
    
        // Save the "final four" type tests - the ones we can't decide about
        var current_tests = {};
        for (var t in result.competitors) {
            if (t) {
                current_tests[result.competitors[t].name] = result.competitors[t];
            }
        }
    
        // Find highest confidence that row is bad
        var worst = [];
        var that = this;
        $.each(current_tests, function(t) {        
            var test_res = [];
            for (var i in result.competitors) {
                if (i) {
                    var opponent = result.competitors[i];
                    test_res.push(competition([t, opponent]).test_results[t.name][0]);
                }
            }
        
            // Sort by conversion rate descending
            test_res.sort(function(x, y) { return y.conv > x.conv; });
        
            // Then sort by p-value ascending
            // This is equiv. to sort by (p, -conv)
            test_res.sort(function(x, y) { return x.p - y.p; });
            var confidence = mp.utility.floatformat((1 - test_res[0].p) * 100, 1);

            t.confidence = confidence;
            t.confidence_string = confidence + "% confident";
            t.confidence_strength = that.adjectives[test_res[0].p];
            t.worse_than = test_res[0];
            t.worse_than_name = test_res[0].vs;
        });
        if (worst.length) {
            result['conclusion'] = "There's no clear winner between the segments, but there are some clear losers:";
            result['losers'] = worst;
        } else {
            result['conclusion'] = "There's no clear winner between the segments. We need more visitors before this test can be measured.";
        }
    },
    best: function(result) {
        result.winners[0].confidence = mp.utility.floatformat((1 - result.winners[0].p) * 100, 1);
        result.winners[0].confidence_string = result.winners[0].confidence + "% confident";
        result.winners[0].confidence_strength = this.adjectives[result.winners[0].p];
        result.winners[0].better_than = 'all';
    }
};
