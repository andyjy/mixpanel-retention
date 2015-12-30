//
// Retention.js
//

var COL_PEOPLE = '   People';
var FROM_DAYS = 30;

var eventSelect,
  cohortEventSelect,
  intervalSelect,
  dateSelect,
  dateRange,
  lineChart,
  summaryChart,
  table,
  table_rolling,
  table_summary,
  retentionResults = {};

var init = function() {
  segmentAnalytics();

  intervalSelect = $('#intervalSelect').MPSelect({items:[
    {label:"Day", value:'day'}, {label:"Week", value:'week'}, {label:"Month", value:'month'}
  ]});
  dateSelect = $('#dateSelect').MPDatepicker();
  dateRange = {from: moment().subtract(FROM_DAYS, 'days').toDate(), to: moment().subtract(2, 'days').toDate()};
  lineChart = $('#lineChart').MPChart({chartType: 'line', yLabel: '% users returned', data:{}});
  summaryChart = $('#summaryChart').MPChart({chartType: 'line', yLabel: '% users returned', data:{}});
  table = $('#table').MPTable({firstColHeader: 'Cohort', data:{}});
  table_rolling = $('#table_rolling').MPTable({firstColHeader: 'Cohort', data:{}});
  table_summary = $('#table-summary').MPTable();
  dateSelect.val(dateRange);

  $.when(customEvents(), MP.api.topEvents({type:'general', limit: 100})).done(function(custom_events, events) {
    var all_events = {}
    for (var i in custom_events) {
      all_events[i] = custom_events[i] + '   ❉';
    }
    events = events.values();
    for (var i in events) {
      all_events[events[i]] = events[i];
    }
    // sort by event name
    all_events = _.chain(all_events)
      .pairs()
      .sortBy(function(s) {
          return s[1];
      })
      .object()
      .value();
    all_events = $.map(all_events, function(a,b) {return {label:a, value:b}})

    eventSelect = $('#eventSelect').MPSelect({items:[{label:"Anything", value:''}].concat(all_events)});
    eventSelect.on('change', runQuery);

    cohortEventSelect = $('#cohortEventSelect').MPSelect({items:[{label:"- Please select -", value:''}].concat(all_events)});
    cohortEventSelect.on('change', runQuery);
  });

  dateSelect.on('change', function () {
    dateRange = dateSelect.val();
    runQuery();
  });
  intervalSelect.on('change', function() {
    interval = intervalSelect.val();
    displayResults(retentionResults[interval], interval);
    analytics.track('Switched Interval', {interval: interval});
  });
  $('#cohortFilter').on('change', runQuery);
  $('#segmentExpr').on('change', runQuery);
}

var pad = function(num, size, char) {
  if (!char) { char = ' ' }
  var s = num+"";
  while (s.length < size) s = char + s;
  return s;
}

var numberWithCommas = function (x) {
  var parts = x.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

var customEvents = function (params, settings_or_callback) {
  var args = mp.utility.process_optional_args([params, settings_or_callback], ['Object', 'Object|Function']);
  params = args[0];
  settings_or_callback = args[1];
  params = _.extend({}, params);
  return MP.api.query('/api/2.0/custom_events/', params, settings_or_callback, function (data) {
    data = JSON.parse(data);
    ces = {};
    $.each(data['custom_events'], function (i,e) {
      if (!e.deleted) {
        ces['$custom_event:' + e.id] = e.name;
      }
    });
    analytics.track('Custom Events Loaded', {count: Object.keys(ces).length});
    analytics.identify({'Custom Events': Object.keys(ces).length});
    return ces;
  });
}

var MPAPIRetentionFix = function (event, params, settings_or_callback) {
  var args = mp.utility.process_optional_args([params, settings_or_callback], ['Object', 'Object|Function']);
  params = args[0];
  settings_or_callback = args[1];

  params = _.extend({
    event: event,
    from: moment().subtract(1, 'months'),
    to: moment(),
    unit: 'day'
    // FIX: REMOVED THIS limit: 100
  }, params);

  if (_.has(params, 'segment')) {
    params.on = MP.api._formatPropertiesParam(params.segment);
    delete params.segment;
  }

  if (params.born_event) {
    if (params.born_event.event) {
      if (params.born_event.where) {
        params.born_where = params.born_event.where;
      }
      params.born_event = params.born_event.event;
    }
    params.retention_type = 'birth';
  } else {
    params.retention_type = 'compounded'; // this is a misnomer. see docs for details
  }

  return MP.api.query('/api/2.0/retention/', params, settings_or_callback, function (data) {
    data = JSON.parse(data);
    return MP.Data.inst(data);
  });
};

var runQuery = function() {
  var eventName = eventSelect.MPSelect('value'),
      cohortEventName = cohortEventSelect.MPSelect('value'),
      interval = intervalSelect.MPSelect('value'),
      cohortFilter = $('#cohortFilter').val(),
      segmentExpr = $('#segmentExpr').val();

  cohortEventName = cohortEventName ? cohortEventName : 'Register';
  eventName = eventName == null ? '' : eventName;
  interval = interval ? interval : 'day';

  if (cohortEventName) {
    analytics.track('Ran Query', {has_event: eventName != '', is_filtered: cohortFilter != '', is_segmented: segmentExpr != ''});

    $('#dataSection').show();
    summaryChart.MPChart('setData', {});
    lineChart.MPChart('setData', {});
    table.MPTable('setData', {});

    var params = {
      from: dateRange.from,
      to: dateRange.to,
      interval_count: 60,
      born_event: cohortEventName,
      born_where: cohortFilter,
      born_on: segmentExpr
    };

    $.when(
      MPAPIRetentionFix(eventName, $.extend({unit: 'day'}, params)),
      MPAPIRetentionFix(eventName, $.extend({unit: 'week'}, params)),
      MPAPIRetentionFix(eventName, $.extend({unit: 'month'}, params))
    ).done(function(results_day, results_week, results_month) {
      var summary = {},
        summaryResults = {}
        summaryChartData = {};

      retentionResults = {
        day: processResult(results_day.values(), segmentExpr),
        week: processResult(results_week.values(), segmentExpr),
        month: processResult(results_month.values(), segmentExpr)
      };

      if (segmentExpr) {
        $('#tables').hide();
        $('#detailSection').hide();
        var segments = {}
        for (k in retentionResults['day']) {
          segments[k] = {name: k};
        }
      } else {
        $('#tables').show();
        $('#analysis').hide();
        $('#detailSection').show();
        displayResults(retentionResults[interval], interval);
      }

      var maxDates = function(interval, intervals) {
        var result = {}
        for (i = 0; i < intervals.length; i++) {
          // we require 2 intervals before daily retention is fully collected
          result[intervals[i]] = moment().subtract(Number.parseInt(intervals[i]) + 2, interval).format("YYYY-MM-DD");
        }
        return result;
      }

      $.each(
        segmentExpr ? retentionResults['day'] : [null],
        function(segment) {
          var k1 = (segment ? segment + ': ' : '') + 'Population',
            k2 = segment ? segment : dateRange.from.toDateString() + ' - ' + dateRange.to.toDateString();
          summary[k1] = {}; summary[k2] = {};
          $.each([
              ['day', {total:'', ' Day  1':1, ' Day  3':3, ' Day  7':7, ' Day 14':14, ' Day 28':28, ' Day 60':60, ' Day 90':90}],
              ['week', {' Week 1':1, ' Week 2':2, ' Week 3':3, ' Week 4':4}],
              ['month', {'Month 1':1, 'Month 2':2}]
            ],
            function(i, v) {
              if (summaryResults[v[0]] == undefined) {
                summaryResults[v[0]] = {};
              }
              var r = summaryResults[v[0]][segment] = overallAverage(
                segment ? retentionResults[v[0]][segment] : retentionResults[v[0]],
                ['total'].concat($.map(v[1], function(e) {return e.toString()})),
                maxDates(v[0], $.map(v[1], function(e) {return e}))
              );
              for (i in v[1]) {
                if (i == 'total') {
                  summary[k1][i] = '';
                  summary[k2][i] = r.population['total'];
                } else {
                  summary[k1][i] = r.population[v[1][i]];
                  summary[k2][i] = r.average_percent[v[1][i]];
                }
              }
              if (v[0] == 'day') {
                summaryChartData[k2] = overallAverage(
                  segment ? retentionResults[v[0]][segment] : retentionResults[v[0]],
                  $.map(_.range(0, 31), function(e) {return e.toString()}),
                  maxDates(v[0], $.map(_.range(0, 31), function(e) {return e.toString()}))
                );
              }
            }
          );
        }
      );
      // standardise table columns
      (function (table) {
        var cols = {};
        for (r in table) {
          for (c in table[r]) {
            if (table[r][c] != undefined) {
              cols[c] = 1;
            }
          }
        }
        for (r in table) {
          for (c in cols) {
            if (table[r][c] == undefined) {
              table[r][c] = '';
            }
          }
        }
      })(summary);
      populateTable(table_summary, summary, true, COL_PEOPLE, '  < 1 ' + interval);

      var has_rekeys = false;
      for (segment in summaryChartData) {
        var rekeyed = {};
        for (k in summaryChartData[segment].average_percent) {
          if (summaryChartData[segment].population_average[k] > 10) {
            rekeyed['D' + k + ' '] = summaryChartData[segment].average_percent[k];
            has_rekeys = true;
          }
        }
        delete summaryChartData[segment];
        summaryChartData[segmentExpr ? segment : 'All Users'] = rekeyed;
      }
      if (has_rekeys) {
        summaryChart.show();
        summaryChart.MPChart('setData', summaryChartData);
      } else {
        summaryChart.hide();
      }

      if (segmentExpr) {
        $('#analysis').show();
        $('#analysis').html('<h2>Day 1 retention</h2>');
        lookForWinner(summaryResults['day'], '1', 'day');
        $('#analysis').append('<h2>Week 1 retention</h2>');
        lookForWinner(summaryResults['week'], '1', 'week');
      }
    });
  }
};

var lookForWinner = function(results, column, interval) {
  var variations = $.map(results, function(v, segment) {
    return {
      name: segment,
      visitors: v.population[column],
      goals: v.sum[column]
    }
  });
  variations = variations.filter(function(x) {
    // exclude variations without some sensible minimum visitors from our analysis so they don't trigger silly results
    return x.visitors >= 100;
  });
  variations.sort(function(x, y) {
    return x.goals / x.visitors - y.goals / y.visitors;
  });
  var result = competition(variations);
  if (result.winners.length === 0) {
    // Multiple winners: highlight the ones we can throw out instead
    resultset.worst(result);
    $('#analysis').append('<p>' + result.conclusion + '</p>');
    analytics.track('Segment Test Result', {column: column, interval: interval, has_winner: false, conclusion: result.conclusion});
  } else if (result.winners.length == 1) {
    // Single winner: highlight the best
    resultset.best(result);
    $('#analysis').append("<p>We are <strong>" + result.winners[0].confidence_strength + " (" + result.winners[0].confidence + "%)</strong> that segment <strong>&quot;" + escapeHTML(result.winners[0].name) + "&quot;</strong> performs <strong>better</strong> than the others.</p>");
    analytics.track('Segment Test Result', {column: column, interval: interval, has_winner: true, confidence: result.winners[0].confidence});
  } else {
    analytics.track('Segment Test Result', {column: column, interval: interval, has_winner: false, nothing_toreport: true});
  }
  console.log(result);
}

var escapeHTML = function(s) {
  return String(s).replace(/&(?!\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var calculatePercent = function(source_data) {
  // deep copy to prevent changes returning up the stack
  var data = $.extend(true, {}, source_data);
  for (k in data) {
    for (k2 in data[k]) {
      if (k2 != 'total' && k2 != 'total_sum') {
        data[k][k2] = data[k]['total'] > 0 ? Math.round(data[k][k2]/data[k]['total']*1000)/10 : 0;
      }
    }
  }
  return data;
}

var populateTable = function(table, source_data, format_percent, total_label, zero_label, interval) {
  // deep copy to prevent changes returning up the stack
  var data = $.extend(true, {}, source_data);

  var max_v2 = 0, min_v2 = 100, first_key, thunderbirds_are_go = false;
  for (k in data) {
    if (!first_key) { first_key = k; }
    for (k2 in data[k]) {
      // formatting
      if (data[k][k2] !== '') {
        if ((k2 != 'total') && (k != 'total') && (data[k]['total'] != '') && (data[k][total_label] != '')) {
          if (format_percent) {
            data[k][k2] = data[k][k2] + "%";
          } else {
            data[k][k2] = numberWithCommas(data[k][k2]);
          }
          if (interval && (k > moment().subtract(Number.parseInt(k2) + 2, interval).format("YYYY-MM-DD"))) {
            data[k][k2] = data[k][k2] + '…';
          }
        } else if (data[k]['total'] == 0 && k2 != 'total' && data[k][k2] == 0) {
          data[k][k2] = '';
        } else {
          data[k][k2] = numberWithCommas(data[k][k2]);
        }
      }
      v2 = Number.parseFloat(data[k][k2]) | 0;
      if (!_.contains(['total', '0'], k2)) {
        if (k !== 'total' && (data[k]['total'] != '') && (data[k][total_label] != '')) {
          // calculate min + max range for values for column 3 onwards (exclude totals + zero-interval)
          max_v2 = Math.max(max_v2, v2);
          min_v2 = Math.min(min_v2, v2);
        }
        // pad numeric column headers with leading spaces to ensure correct sorting
        k2_old = k2;
        if ((k2 = pad(k2, 2)) != k2_old) {
          data[k][k2] = data[k][k2_old];
          delete data[k][k2_old];
        }
      }
      if (k2 == 'total' && total_label && (total_label != k2)) {
        data[k][total_label] = data[k][k2];
        delete data[k][k2];
      }
      if (k2 == '0' && zero_label && (zero_label != k2)) {
        data[k][zero_label] = data[k][k2];
        delete data[k][k2];
      }
    }
    // ensure we have all the cells populated so that the table will display
    if (k != first_key) {
      for (k2 in data[first_key]) {
        if (typeof(data[k][k2]) == 'undefined') {
          data[k][k2] = '';
        }
      }
    }
  }

  table.MPTable('setData', data);

  // add formatting
  var heat_interval = (max_v2 - min_v2) / 5;
  table.find('.mp_chart_row:not(.mp_chart_header):not(:has(:nth-child(2) .content:empty)) .mp_chart_cell:nth-child(3)').addClass('zero_bucket');
  table.find('.mp_chart_row:not(.mp_chart_header):not(:has(:nth-child(2) .content:empty)) .mp_chart_cell:not(:first-child):not(:nth-child(2)):not(:nth-child(3)):not(:has(.content:empty()))')
    .each(function(i, c) {
      v = (Number.parseFloat(c.textContent));
      if (v > max_v2 - heat_interval) {
        $(c).addClass('data_heat_5');
      } else if (v > max_v2 - heat_interval*2) {
        $(c).addClass('data_heat_4');
      } else if (v > max_v2 - heat_interval*3) {
        $(c).addClass('data_heat_3');
      } else if (v > max_v2 - heat_interval*4) {
        $(c).addClass('data_heat_2');
      } else if (v > 0) {
        $(c).addClass('data_heat_1');
      } else {
        $(c).addClass('data_zero');
      }
    });
  table.find('.mp_chart_row:not(.mp_chart_header) .mp_chart_cell:not(:first-child):not(:nth-child(2)):has(.content:empty())').addClass('empty');
}

var rollingAverage = function(data, window_size, max_dates) {
  window_size = window_size ? window_size : 7;
  max_dates = max_dates ? max_dates : {};
  var history = {},
    results = $.extend(true, {}, data),
    trim_keys = [];
  for (k in results) {
    for (k2 in results[k]) {
      if (max_dates[k2] != undefined && (k > max_dates[k2])) {
        continue;
      }
      v2 = results[k][k2];
      if (typeof(history[k2]) == 'undefined') {
        history[k2] = {sum:0, values:[]};
      }
      if (v2 !== '') {
        v2_num = Number.parseFloat(v2) | 0;
        history[k2]['values'].push(v2_num);
        history[k2].sum = history[k2].sum + v2_num;
        if (history[k2]['values'].length > window_size) {
          history[k2].sum = history[k2].sum - history[k2]['values'].shift();
        }
        if (history[k2]['values'].length < window_size) {
          trim_keys.push(k);
        } else {
          var decimals = k2 == 'total' ? 0 : 1;
          results[k][k2] = Math.round(history[k2].sum / history[k2]['values'].length * Math.pow(10, decimals))/Math.pow(10, decimals);
        }
      }
    }
    for (var i=0; i < trim_keys.length; i++) {
      delete results[trim_keys[i]];
    }
  }
  return results;
}

var overallAverage = function(data, keys, max_dates) {
  var history = {},
    data = $.extend(true, {}, data)
    results = {population:{}, sum:{}, average:{}, population_average:{}, average_percent:{}};
  max_dates = max_dates ? max_dates : {};
  for (k in data) {
    for (k2 in data[k]) {
      if (!_.contains(keys, k2) || (max_dates[k2] != undefined && (k > max_dates[k2]))) {
        continue;
      }
      if (typeof(history[k2]) == 'undefined') {
        history[k2] = {sum:0, length:0, population:0};
      }
      v2 = data[k][k2];
      if (v2 !== '') {
        v2_num = Number.parseFloat(v2) | 0;
        history[k2].sum = history[k2].sum + v2_num;
        history[k2].length = history[k2].length + 1;
        history[k2].population = history[k2].population + data[k]['total'];
      }
    }
  }
  for (k in history) {
    var decimals = k == 'total' ? 0 : 1;
    results.population_average[k] = Math.round(history[k].population / history[k].length);
    if (results.population_average[k] > 0) {
      results.sum[k] = history[k].sum;
      results.average[k] = Math.round(history[k].sum / history[k].length * Math.pow(10, decimals))/Math.pow(10, decimals);
      results.population[k] = history[k].population;
      results.average_percent[k] = Math.round(results.average[k]/results.population_average[k]*1000)/10;
    } else {
      results.sum[k] = undefined;
      results.average[k] = undefined;
      results.population[k] = undefined;
      results.average_percent[k] = undefined;
    }
  }
  return results;
}

var processResult = function (data, is_segmented) {
  var results = {};
  is_segmented = is_segmented ? true : false;
  if (is_segmented) {
    for (k in data) {
      for (s in data[k]) {
        if (typeof(results[s]) == 'undefined') {
          results[s] = {}
        }
        if (typeof(results[s][k]) == 'undefined') {
          results[s][k] = data[k][s];
        }
      }
    }
    for (s in results) {
      results[s] = processResult(results[s], false);
    }
    results = _.chain(results)
      .pairs()
      .sortBy(function(s) { return s[0]; })
      .object()
      .value();
    return results;
  }
  for (k in data) {
    results[k] = {total: data[k].first};
    for (k2 in data[k].counts) {
      results[k][k2] = data[k].counts[k2];
    }
  }
  return results;
}

var displayResults = function(data, interval) {
  var results = _.chain(data)
    .pairs()
    .sortBy(function(s) { return s[0]; })
    .object()
    .value();

  var trimTrailingEmptyRows = function(data) {
    var data = $.extend({}, data);
    for (k in data) {
      if ((data[k]['total'] != 0) || (data[k][0] != 0)) {
        break;
      }
      delete data[k];
    }
    return data;
  }

  var results_percent = calculatePercent(results);
  populateTable(table, trimTrailingEmptyRows(results_percent), true, COL_PEOPLE, '  < 1 ' + interval, interval);

  if (interval == 'day') {
    var results_rolling = rollingAverage(results, 7);
    $('#rolling-averages').show();
    var results_rolling_percent = calculatePercent(results_rolling);
    populateTable(table_rolling, trimTrailingEmptyRows(results_rolling_percent), true, COL_PEOPLE, '  < 1 ' + interval, interval);
  } else if (interval == 'week') {
    var results_rolling = rollingAverage(results, 4);
    $('#rolling-averages').show();
    var results_rolling_percent = calculatePercent(results_rolling);
    populateTable(table_rolling, trimTrailingEmptyRows(results_rolling_percent), true, COL_PEOPLE, '  < 1 ' + interval, interval);
  } else {
    $('#rolling-averages').hide();
  }

  //
  // chart for 1d, 7d, 28d retention
  //
  var chart = {};
  if (interval == 'week') {
    _.extend(chart, {'Week 1': {}, 'Week 2': {}, 'Week 4':{}, 'W1 (4w avg)': {}, 'W2 (4w avg)': {}, 'W4 (4w avg)':{}});
    $.each(results_percent, function(k, v) {
      if (!isNaN(w = Number.parseFloat(v[1]))) { chart['Week 1'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[2]))) { chart['Week 2'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[4]))) { chart['Week 4'][k] = w }
    });
    $.each(results_rolling_percent, function(k, v) {
      if (!isNaN(w = Number.parseFloat(v[1]))) { chart['W1 (4w avg)'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[2]))) { chart['W2 (4w avg)'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[4]))) { chart['W4 (4w avg)'][k] = w }
    });
  } else if (interval == 'month') {
    _.extend(chart, {'Month 1': {}, 'Month 2': {}, 'Month 3':{}});
    $.each(results_percent, function(k, v) {
      if (!isNaN(w = Number.parseFloat(v[1]))) { chart['Month 1'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[2]))) { chart['Month 2'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[3]))) { chart['Month 3'][k] = w }
    });
  } else { // interval == 'day'
    _.extend(chart, {'Day 1': {}, 'Day 7': {}, 'Day 28':{}, 'D1 (7d avg)': {}, 'D7 (7d avg)': {}, 'D28 (7d avg)':{}});
    $.each(results_percent, function(k, v) {
      if (!isNaN(w = Number.parseFloat(v[1]))) { chart['Day 1'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[7]))) { chart['Day 7'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[28]))) { chart['Day 28'][k] = w }
    });
    $.each(results_rolling_percent, function(k, v) {
      if (!isNaN(w = Number.parseFloat(v[1]))) { chart['D1 (7d avg)'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[7]))) { chart['D7 (7d avg)'][k] = w }
      if (!isNaN(w = Number.parseFloat(v[28]))) { chart['D28 (7d avg)'][k] = w }
    });
  }
  lineChart.MPChart('setData', chart);
}

var displaySegmentedResults = function(data, interval) {
  var chart = {};
  for (segment in data) {
    var results = _.chain(data[segment])
    .pairs()
    .sortBy(function(s) { return s[0]; })
    .object()
    .value();

    var results_percent = calculatePercent(results);

    if (interval == 'day') {
      var results_rolling = rollingAverage(results, 7);
      var results_rolling_percent = calculatePercent(results_rolling);
    } else if (interval == 'week') {
      var results_rolling = rollingAverage(results, 4);
      var results_rolling_percent = calculatePercent(results_rolling);
    }

    if (interval == 'week') {
      chart['W1: '+segment] = {}; //, 'W2: '+segment: {}, 'W4: '+segment:{}});
      $.each(results_rolling_percent, function(k, v) {
        if (!isNaN(w = Number.parseFloat(v[1]))) { chart['W1: '+segment][k] = w }
        //if (!isNaN(w = Number.parseFloat(v[2]))) { chart['2w (4w avg)'][k] = w }
        //if (!isNaN(w = Number.parseFloat(v[4]))) { chart['4w (4w avg)'][k] = w }
      });
    } else if (interval == 'month') {
      chart['M1: '+segment] = {}; //, 'M2: '+segment: {}, 'M3: '+segment:{}});
      $.each(results_percent, function(k, v) {
        if (!isNaN(w = Number.parseFloat(v[1]))) { chart['M1: '+segment][k] = w }
        //if (!isNaN(w = Number.parseFloat(v[2]))) { chart['2 months'][k] = w }
        //if (!isNaN(w = Number.parseFloat(v[3]))) { chart['3 months'][k] = w }
      });
    } else { // interval == 'day'
      chart['D1: '+segment] = {}; //, '7d (7d avg)': {}, '28d (7d avg)':{}});
      $.each(results_rolling_percent, function(k, v) {
        if (!isNaN(w = Number.parseFloat(v[1]))) { chart['D1: '+segment][k] = w }
        //if (!isNaN(w = Number.parseFloat(v[7]))) { chart['7d (7d avg)'][k] = w }
        //if (!isNaN(w = Number.parseFloat(v[28]))) { chart['28d (7d avg)'][k] = w }
      });
    }
  }

  lineChart.MPChart('setData', chart);
}

var segmentAnalytics = function() {
  !function(){var analytics=window.analytics=window.analytics||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","page","once","off","on"];analytics.factory=function(t){return function(){var e=Array.prototype.slice.call(arguments);e.unshift(t);analytics.push(e);return analytics}};for(var t=0;t<analytics.methods.length;t++){var e=analytics.methods[t];analytics[e]=analytics.factory(e)}analytics.load=function(t){var e=document.createElement("script");e.type="text/javascript";e.async=!0;e.src=("https:"===document.location.protocol?"https://":"http://")+"cdn.segment.com/analytics.js/v1/"+t+"/analytics.min.js";var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(e,n)};analytics.SNIPPET_VERSION="3.1.0";
    analytics.load("KHc3WYdCg1Gq1Cyz96jcze267x7K0DVC");
    analytics.identify({'Mixpanel Key': MP.api.apiKey});
    analytics.group(MP.api.apiKey);
    analytics.page('', 'Index', {url: location.href.replace(/api_secret=[^&]*/, ''), search: location.search.replace(/api_secret=[^&]*/, '')});
    analytics.ready(function() {
      if (!window.analytics.user().traits().createdAt) {
        window.analytics.alias(window.analytics.user().anonymousId());
        window.analytics.identify(window.analytics.user().anonymousId(), {createdAt: moment().format('YYYY-MM-DD HH:mm:ss')});
      }
    });
  }}();
}

//
// html
//
$('body').append('\
<div class="mixpanel-platform-section config-section">\
  <div class="mixpanel-platform-label section-label">\
    Show me people who did\
  </div>\
  <div id="cohortEventSelect" style="float: left;"></div>\
  <div style="clear: both;"></div>\
\
  <div class="mixpanel-platform-label section-label">\
    Then came back and did\
  </div>\
  <div id="eventSelect" style="float: left;"></div>\
  <div style="clear: both;"></div>\
\
  <div class="mixpanel-platform-label section-label">\
    Filter first event by\
  </div>\
  <div style="float: left;" class="mixpanel-platform-input">\
    <input type="text" id="cohortFilter"></input>\
  </div>\
  <div style="clear: both;"></div>\
\
  <div class="mixpanel-platform-label section-label">\
    Segment first event by\
  </div>\
  <div style="float: left;" class="mixpanel-platform-input">\
    <input type="text" id="segmentExpr"></input>\
  </div>\
  <div style="clear: both;"></div>\
\
  <div class="mixpanel-platform-label section-label">\
    Date range\
  </div>\
  <div id="dateSelect" style="float: left;"></div>\
  <div style="clear: both;"></div>\
</div>\
\
<div id="dataSection" style="display:none">\
  <div class="mixpanel-platform-section">\
    <div id="analysis"></div>\
    <div id="table-summary"></div>\
    <div id="summaryChart"></div>\
  </div>\
\
  <div class="mixpanel-platform-section" id="detailSection">\
    <div id="intervalSelect" style="float: right;" class="interval-select"></div>\
    <div class="mixpanel-platform-label section-label" style="float:right">\
      Cohort by\
    </div>\
    <div style="clear: both;"></div>\
\
    <div id="lineChart"></div>\
  </div>\
\
  <div id="tables">\
    <div class="mixpanel-platform-section">\
      <div id="table"></div>\
    </div>\
\
    <div class="mixpanel-platform-section" id="rolling-averages" style="display: none;">\
      <h1>\
        Rolling averages\
      </h1>\
      <div id="table_rolling"></div>\
    </div>\
  </div>\
</div>\
<footer>\
  <p>☞ &nbsp; Custom report for Mixpanel retention analysis and A/B testing &nbsp; ☜<br>\
  © Andy Young, <a href="http://500.co" target="_blank">500 Startups</a> Distro Team ~ <a href="https://twitter.com/andyy" target="_blank">@andyy</a></p>\
  <p><em>' + (Math.random() > 0.5 ?
  '“They\'re not anecdotes - that\'s small batch artisanal data.” ~ <a href="https://twitter.com/pikelet/status/570061993949818881" target="_blank">@pikelet</a>'
  : (Math.random() > 0.5 ? '“The temptation to form premature theories upon insufficient data is the bane of our profession.” ~ Sherlock Holmes'
  : '“If we have data, let\'s look at data. If all we have are opinions, let\'s go with mine.” ~ Jim Barksdale')) + '</em></p>'
  + '<img src="https://andyyoung.github.io/mixpanel-retention/500-black.png">\
</footer>\
<script src="https://andyyoung.github.io/mixpanel-retention/calculator.js"></script>\
');

$(init);
