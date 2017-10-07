const St        = imports.gi.St;
const Gtk       = imports.gi.Gtk;
const Shell     = imports.gi.Shell;
const Pango     = imports.gi.Pango;
const Clutter   = imports.gi.Clutter;
const Main      = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Lang      = imports.lang;
const Signals   = imports.signals;
const Mainloop  = imports.mainloop;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const FUZZ           = ME.imports.lib.fuzzy_search;
const RESIZE         = ME.imports.lib.resize_label;
const GRAPHS         = ME.imports.lib.graphs;
const FULLSCREEN     = ME.imports.lib.fullscreen;
const DATE_PICKER    = ME.imports.lib.date_picker;
const SCROLL_TO_ITEM = ME.imports.lib.scroll_to_item;


const G = ME.imports.sections.todo.GLOBAL;


// =====================================================================
// @@@ Stats View
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @monitor  : int (monitor position)
// =====================================================================
var StatsView = new Lang.Class({
    Name    : 'Timepp.StatsView',
    Extends : FULLSCREEN.Fullscreen,

    _init: function (ext, delegate, monitor) {
        this.parent(monitor);

        this.ext      = ext;
        this.delegate = delegate;

        this.default_style_class = this.actor.style_class;
        this.actor.add_style_class_name('stats');
        this.set_banner_size(0);
        this.middle_box.vertical = false;
        this.bottom_box.hide();
        {
            let visible = this.monitor_button.visible;
            this.top_box_left.remove_child(this.monitor_button);
            this.top_box_right.insert_child_at_index(this.monitor_button, 0);
            this.monitor_button.visible = visible;
        }


        // Values as returned by the time tracker's get_stats. The unique
        // entries Set is converted to an array.
        this.stats_data           = null;
        this.stats_unique_entries = null;


        // A map between 'human-readable' properties and translated strings as
        // well as date intervals consisting of two date strings in 'yyyy-mm-dd'
        // format.
        // date_str === '' represents an open/half-open interval.
        //
        // The dates intervals are updated by _update_string_date_map() func.
        //
        // @key: string
        // @val: array (of the form [translated_str, range])
        //   - @range: array (of the form [date_str, date_str])
        this.string_date_map = new Map([
            ['today'        , [_('Today')         , ['', '']] ],
            ['week'         , [_('This Week')     , ['', '']] ],
            ['month'        , [_('This Month')    , ['', '']] ],
            ['three_months' , [_('Last 3 Months') , ['', '']] ],
            ['six_months'   , [_('Last 6 Months') , ['', '']] ],
            ['all'          , [_('All Time')      , ['', '']] ],
        ]);

        this._update_string_date_map();


        // See the comment on the _set_mode() func for an explanation on how the
        // stat modes are handled.
        this.mode = {
            BANNER : 'BANNER',
            GLOBAL : 'GLOBAL',
            SINGLE : 'SINGLE',
            SEARCH : 'SEARCH',
            HOT    : 'HOT',
        };

        this.current_mode = this.prev_mode = {
            name   : '',
            args   : null,
            actors : null,
        }


        // Used by the _search() func.
        this.selected_search_result = null;

        this.hot_mode_show_tasks = false; // true = task, false = projects


        // A map from mode names to functions that invoke it.
        this.mode_func_map = {
            [this.mode.BANNER] : this.show_mode__banner,
            [this.mode.GLOBAL] : this.show_mode__global,
            [this.mode.SINGLE] : this.show_mode__single,
            [this.mode.HOT]    : this.show_mode__hot,
        };


        // We want to be able to style certain parts of the graph using css.
        // The _update_graph_css_info() func will get that info by looking for
        // custom css properties and store it in this obj.
        //
        // @key: Is equal to the css property.
        // @val: Array into which we store a color in both hex and rgba format.
        //       The hex string is used for color comparison.
        this.graph_css = {
            ['-timepp-axes-color']      : ['#ffffffff', [1, 1, 1, 1]],
            ['-timepp-y-label-color']   : ['#ffffffff', [1, 1, 1, 1]],
            ['-timepp-x-label-color']   : ['#ffffffff', [1, 1, 1, 1]],
            ['-timepp-rulers-color']    : ['#ffffffff', [1, 1, 1, 1]],
            ['-timepp-proj-vbar-color'] : ['#ffffffff', [1, 1, 1, 1]],
            ['-timepp-task-vbar-color'] : ['#ffffffff', [1, 1, 1, 1]],
        };


        //
        // nav bar
        //
        this.nav_bar = new St.BoxLayout({ style_class: 'navbar' });
        this.top_box_right.insert_child_at_index(this.nav_bar, 0);

        this.single_mode_icon = new St.Button({ y_align: St.Align.MIDDLE, can_focus: true });
        this.nav_bar.add_actor(this.single_mode_icon);
        this.single_mode_icon.add_actor(new St.Icon({ icon_name: 'timepp-search-symbolic' }));

        this.global_mode_icon = new St.Button({ y_align: St.Align.MIDDLE, can_focus: true });
        this.nav_bar.add_actor(this.global_mode_icon);
        this.global_mode_icon.add_actor(new St.Icon({ icon_name: 'timepp-eye-symbolic' }));

        this.hot_mode_icon = new St.Button({ y_align: St.Align.MIDDLE, can_focus: true });
        this.nav_bar.add_actor(this.hot_mode_icon);
        this.hot_mode_icon.add_actor(new St.Icon({ icon_name: 'timepp-fire-symbolic' }));


        //
        // search entry and results container
        //
        this.entry = new St.Entry({ can_focus: true, y_align: Clutter.ActorAlign.CENTER, visible: false, hint_text: _('Search...') });
        this.top_box_center.add_actor(this.entry);
        this.entry.set_primary_icon(new St.Icon({ icon_name: 'timepp-search-symbolic' }));

        this.search_results_container = new St.BoxLayout({ visible: false, x_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true, vertical: true, style_class: 'search-results-box' });
        this.middle_box.add_actor(this.search_results_container);

        this.search_scrollview = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER, style_class: 'vfade' });
        this.search_results_container.add_actor(this.search_scrollview);

        this.search_results_content = new St.BoxLayout({ y_expand: true, vertical: true });
        this.search_scrollview.add_actor(this.search_results_content);


        //
        // date picker
        //
        {
            let today      = G.date_yyyymmdd();
            let year_start = today.substr(0, 4) + '-01-01';

            this.date_picker = new DATE_PICKER.DatePicker(
                '',
                today,
                [_('Year:'), _('Month:'), _('Day:')]
            );

            this.date_picker.actor.hide();
            this.top_box_left.insert_child_at_index(this.date_picker.actor, 0);
        }


        //
        // hot mode controls
        //
        {
            let today = G.date_yyyymmdd();

            this.hot_mode_control_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, visible: false, style_class: 'hot-mode-control-box' });
            this.top_box_left.insert_child_at_index(this.hot_mode_control_box, 0);


            // custom range view
            this.date_range_custom_view = new St.BoxLayout({ visible: false, style_class: 'custom-date-range-box' });
            this.hot_mode_control_box.add_actor(this.date_range_custom_view);

            this.date_range_custom_view.add_actor(new St.Label({ text: _('From: '), y_align: Clutter.ActorAlign.CENTER }));

            this.bound_date_1 = new DATE_PICKER.DatePicker('', today, ['', '', '']);
            this.date_range_custom_view.add_actor(this.bound_date_1.actor);

            this.date_range_custom_view.add_actor(new St.Label({ text: _('To: '), y_align: Clutter.ActorAlign.CENTER }));

            this.bound_date_2 = new DATE_PICKER.DatePicker('', today, ['', '', '']);
            this.date_range_custom_view.add_actor(this.bound_date_2.actor);

            this.custom_range_ok_btn = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'button' });
            this.date_range_custom_view.add_actor(this.custom_range_ok_btn);

            this.custom_range_cancel_btn = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'button' });
            this.date_range_custom_view.add_actor(this.custom_range_cancel_btn);


            // the main view
            this.date_range_main_view = new St.BoxLayout();
            this.hot_mode_control_box.add_actor(this.date_range_main_view);

            this.date_range_main_view.add_actor(new St.Label({ text: _('Type: '), y_align: Clutter.ActorAlign.CENTER }));

            this.type_btn = new St.Button({ can_focus: true, label: '', style_class: 'button' });
            this.date_range_main_view.add_actor(this.type_btn);

            this.type_menu = new PopupMenu.PopupMenu(this.type_btn, 0.5, St.Side.TOP);
            this.menu_manager.addMenu(this.type_menu);
            Main.uiGroup.add_actor(this.type_menu.actor);
            this.type_menu.actor.hide();

            this.date_range_main_view.add_actor(new St.Label({ text: _('Range: '), y_align: Clutter.ActorAlign.CENTER }));

            this.range_btn = new St.Button({ can_focus: true, label: '', style_class: 'button' });
            this.date_range_main_view.add_actor(this.range_btn);

            this.range_menu = new PopupMenu.PopupMenu(this.range_btn, 0.5, St.Side.TOP);
            this.menu_manager.addMenu(this.range_menu);
            Main.uiGroup.add_actor(this.range_menu.actor);
            this.range_menu.actor.hide();


            // fill up
            for (let [,val] of this.string_date_map) {
                let label = val[0];
                let range = val[1];

                this.range_menu.addAction(label, () => {
                    this.show_mode__hot(label, range);
                });
            }

            this.range_menu.addAction(_('Custom Range...'), () => {
                this.date_range_main_view.hide();
                this.date_range_custom_view.show();
                Mainloop.idle_add(() => { this.actor.grab_key_focus(); });
            });

            this.type_menu.addAction(_('Projects'), () => {
                this.hot_mode_show_tasks = false;
                this.show_mode__hot(this.current_mode.args[0],
                                    this.current_mode.args[1]);
            });

            this.type_menu.addAction(_('Tasks'), () => {
                this.hot_mode_show_tasks = true;
                this.show_mode__hot(this.current_mode.args[0],
                                    this.current_mode.args[1]);
            });
        }


        //
        // vbars graph
        //
        this.vbars_graph = new GRAPHS.VBars();
        this.middle_box.add_child(this.vbars_graph.actor);
        this.vbars_graph.actor.hide();


        //
        // sum stats card
        //
        {
            this.stats_card = new St.BoxLayout({ vertical: true, visible: false, x_expand: true, y_expand: true, style_class: 'sum-stats-card' });
            this.middle_box.add_child(this.stats_card);

            ['stats_card_title', 'stats_card_stats'].forEach((it) => {
                let scroll = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER });
                this.stats_card.add_child(scroll);

                let content = new St.BoxLayout({ vertical: true });
                scroll.add_actor(content);

                this[it] = new St.Label();
                content.add_child(this[it]);

                this[it].clutter_text.line_wrap      = true;
                this[it].clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
                this[it].clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            });
        }


        //
        // listen
        //
        this.delegate.connect('new-day', (_, today) => {
            this._on_new_day_started(today);
        });
        this.vbars_graph.connect('vbar-clicked', (_, vbar_label) => {
            let today = new Date();

            this.show_mode__single(today.getFullYear(),
                                   today.getMonth(),
                                   vbar_label);
        });
        this.entry.clutter_text.connect('text-changed', () => {
            this._search();
        });
        this.entry.clutter_text.connect('activate', () => {
            if (this.selected_search_result) {
                let d = new Date();
                this.show_mode__single(d.getFullYear(),
                                       d.getMonth(),
                                       this.selected_search_result.get_text());
            }
        });
        this.actor.connect('key-press-event', (_, event) => {
            switch (event.get_key_symbol()) {
                case Clutter.KEY_f:
                case Clutter.KEY_slash:
                    this.show_mode__search();
                    return Clutter.EVENT_STOP;
                default:
                    return Clutter.EVENT_PROPAGATE;
            }
        });
        this.entry.clutter_text.connect('key-press-event', (_, event) => {
            let direction;

            switch (event.get_key_symbol()) {
                case Clutter.KEY_Up:
                    direction = 1;
                    break;
                case Clutter.KEY_Down:
                    direction = -1;
                    break;
            }

            if (direction) this._navigate_search_results(direction);
        });
        this.single_mode_icon.connect('clicked', (icon) => {
            this.show_mode__search();
            return Clutter.EVENT_STOP;
        });
        this.global_mode_icon.connect('clicked', (icon) => {
            if (this.current_mode.name === this.mode.GLOBAL) {
                return Clutter.EVENT_PROPAGATE;
            }
            else if (this.prev_mode.name === this.mode.GLOBAL) {
                this.show_mode__global(...this.prev_mode.args);
            }
            else {
                this.show_mode__global(G.date_yyyymmdd());
            }

            return Clutter.EVENT_STOP;
        });
        this.hot_mode_icon.connect('clicked', (icon) => {
            if (this.current_mode.name === this.mode.HOT) {
                return Clutter.EVENT_PROPAGATE;
            }
            else if (this.prev_mode.name === this.mode.HOT) {
                this.show_mode__hot(...this.prev_mode.args);
            }
            else {
                this.show_mode__hot(this.string_date_map.get('week')[0],
                                    this.string_date_map.get('week')[1]);
            }

            return Clutter.EVENT_STOP;
        });
        this.range_btn.connect('clicked', () => {
            this.range_menu.toggle();
            return Clutter.EVENT_STOP;
        });
        this.type_btn.connect('clicked', () => {
            this.type_menu.toggle();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('style-changed', () => {
            this._update_graph_css_info();
        });
        this.date_picker.connect('date-changed', (_, date_arr, date_str) => {
            this._on_month_picker_changed(date_arr, date_str);
        });
        this.custom_range_ok_btn.connect('clicked', () => {
            let [, date_str_1] = this.bound_date_1.get_date();
            let [, date_str_2] = this.bound_date_2.get_date();
            let label          = date_str_1 + '   ...   ' + date_str_2;

            this.show_mode__hot(label, [date_str_1, date_str_2]);

            this.date_range_main_view.show();
            this.date_range_custom_view.hide();
            Mainloop.idle_add(() => { this.actor.grab_key_focus(); });
        });
        this.custom_range_cancel_btn.connect('clicked', () => {
            this.date_range_main_view.show();
            this.date_range_custom_view.hide();
            Mainloop.idle_add(() => { this.actor.grab_key_focus(); });
        });
    },

    close: function () {
        this.stats_data           = null;
        this.stats_unique_entries = null;
        this._set_mode('', null, null);

        this.parent();
    },

    // @params as returned by the time tracker's get_stats func()
    set_stats: function (stats_data, stats_unique_entries) {
        this.stats_data           = stats_data;
        this.stats_unique_entries = Array.from(stats_unique_entries);

        this._update_string_date_map();
    },

    show_mode__global: function (date) {
        let actors = [this.vbars_graph.actor, this.date_picker.actor];

        this._set_mode(
            this.mode.GLOBAL,
            [date],
            () => {
                actors.forEach((it) => it.hide());
                this.vbars_graph.draw_vbars([], 8, 64);
            }
        );

        actors.forEach((it) => it.show());
        this.nav_bar.get_children().forEach((it) => it.checked = false);
        this.global_mode_icon.checked = true;

        this.date_picker.set_date_from_string(date);

        this.vbars_graph.draw_coord_system({
            y_max               : 1440,
            y_conversion_factor : 60,
            n_rulers            : 12,
            x_offset            : 30,
            y_offset            : 12,
            y_label_suffix      : 'h',
        });

        this.vbars_graph.draw_vbars(
            this._get_stats__vbars_global(date),
            8,
            64,
            (label, y_val) => {
                let h = Math.floor(y_val / 60);
                h = h ? '' + h + 'h ' : '';

                let m = y_val % 60;
                m = m ? '' + m + 'min' : '';

                return h + m + '\n\n' + label;
            }
        );
    },

    // @year    : int
    // @month   : int    (0-indexed)
    // @keyword : string (projects/task)
    show_mode__single: function (year, month, keyword) {
        let actors = [
            this.stats_card,
            this.date_picker.actor,
            this.vbars_graph.actor,
        ];

        this._set_mode(
            this.mode.SINGLE,
            [year, month, keyword],
            () => {
                actors.forEach((it) => it.hide());
                this.date_picker.day_picker.actor.show();
                this.vbars_graph.draw_vbars([], 8, 64);
            }
        );

        this.date_picker.day_picker.actor.visible = false;
        actors.forEach((it) => it.show());
        this.nav_bar.get_children().forEach((it) => it.checked = false);
        this.single_mode_icon.checked = true;

        this.date_picker.set_date(year, month, 1);

        this.vbars_graph.draw_coord_system({
            y_max               : 1440,
            y_conversion_factor : 60,
            n_rulers            : 12,
            x_offset            : 30,
            y_offset            : 30,
            y_label_suffix      : 'h',
        });

        this.vbars_graph.draw_vbars(
            this._get_stats__vbars_single(year, month, keyword),
            8,
            64,
            (label, y_val) => {
                let h = Math.floor(y_val / 60);
                h = h ? '' + h + 'h ' : '';

                let m = y_val % 60;
                m = m ? '' + m + 'min' : '';

                return h + m;
            }
        );

        // update stats card
        if (this.prev_mode.name !== this.mode.SINGLE ||
            this.prev_mode.args[2] !== keyword) {

            //
            // title
            //
            let markup = G.REG_PROJ.test(keyword) ?
                         _('<b>Stats for <i>project</i>: </b>') :
                         _('<b>Stats for <i>task</i>: </b>');

            markup += '\n\n' + keyword;

            this.stats_card_title.clutter_text.set_markup(
                '<tt>' + markup + '</tt>');

            //
            // stats
            //
            let longest = 0;

            for (let [,v] of this.string_date_map)
                if (v[0].length > longest) longest = v[0].length;

            longest++;

            let stats = this._get_stats__sum(keyword);
            markup    = '';

            for (let [k, v] of this.string_date_map) {
                let h = Math.floor(stats[k] / 60);
                h = h ? '' + h + 'h ' : '';

                let m = stats[k] % 60;
                m = m ? '' + m + 'min' : '0';

                markup +=
                    '<b>' + v[0] + ': </b>' +
                    Array(longest - v[0].length).join(' ') +
                    h + m + '\n\n';
            };

            markup += `\n\n<b>${_('Total time per yearly quarter: ')}</b>`;

            for (let [year, quarters] of stats.quarters) {
                markup += '\n';

                quarters.forEach((it, i) => {
                    let h = Math.floor(it / 60);
                    h = h ? '' + h + 'h ' : '';

                    let m = it % 60;
                    m = m ? '' + m + 'min' : '0';

                    markup += `\n<b>Q${i + 1} ${year}:</b> ${h + m}`;
                });
            }

            this.stats_card_stats.clutter_text.set_markup(`<tt>${markup}</tt>`);
        }
    },

    // @label      : string
    // @range      : array  (of the form [date_str_1, date_str_2])
    show_mode__hot: function (label, range) {
        let actors = [this.vbars_graph.actor, this.hot_mode_control_box]

        this._set_mode(
            this.mode.HOT,
            [label, range],
            () => actors.forEach((it) => {
                it.hide()
                this.vbars_graph.draw_vbars([], 8, 64);
            })
        );

        let lower_bound, upper_bound;

        if (range[0] <= range[1]) {
            lower_bound = range[0];
            upper_bound = range[1];
        }
        else {
            lower_bound = range[1];
            upper_bound = range[0];
        }

        if (!lower_bound) lower_bound = '0000-00-00';
        if (!upper_bound) upper_bound = '9999-99-99';

        actors.forEach((it) => it.show());
        this.nav_bar.get_children().forEach((it) => { it.checked = false; });
        this.hot_mode_icon.checked = true;

        this.range_btn.label = label;
        this.type_btn.label  =
            this.hot_mode_show_tasks ? _('Tasks') : _('Projects');

        let stats            = new Map();
        let rgba             = this.hot_mode_show_tasks ?
                               this.graph_css['-timepp-task-vbar-color'][1] :
                               this.graph_css['-timepp-proj-vbar-color'][1];

        for (let [date, records] of this.stats_data) {
            if (date < lower_bound) break;
            if (date > upper_bound) continue;

            records.forEach((val, key) => {
                if (G.REG_PROJ.test(key) === this.hot_mode_show_tasks) return;
                stats.set(key, (stats.get(key) || 0) + val);
            });
        }

        stats = Array.from(stats);

        stats.sort((a, b) => +(a[1] < b[1]) || +(a[1] === b[1]) - 1);

        let max_vbars = Math.min(stats.length, 100);
        let vbars     = new Array(max_vbars);

        for (let i = 0; i < max_vbars; i++) {
            vbars[i] = {
                label   : stats[i][0],
                y_val   : stats[i][1],
                rgba    : rgba,
                x_label : '',
            };
        }

        let max_hours = (stats.length > 0) ? Math.floor(stats[0][1] / 60) : 24;

        if (max_hours <= 24) {
            this.vbars_graph.draw_coord_system({
                y_max               : 1440,
                y_conversion_factor : 60,
                n_rulers            : 12,
                x_offset            : 30,
                y_offset            : 12,
                y_label_suffix      : 'h',
            });
        }
        else if (max_hours < 1000) {
            this.vbars_graph.draw_coord_system({
                y_max               : 60 * (max_hours + 10 - max_hours % 10),
                y_conversion_factor : 60,
                n_rulers            : 10,
                x_offset            : (max_hours < 100) ? 30 : 40,
                y_offset            : 12,
                y_label_suffix      : 'h',
            });
        }
        else {
            this.vbars_graph.draw_coord_system({
                y_max               : stats[0][1],
                y_conversion_factor : 60000,
                n_rulers            : 10,
                x_offset            : 60,
                y_offset            : 12,
                y_label_suffix      : 'Kh',
            });
        }

        this.vbars_graph.draw_vbars(
            vbars,
            8,
            64,
            (label, y_val) => {
                let h = Math.floor(y_val / 60);
                h = h ? '' + h + 'h ' : '';

                let m = y_val % 60;
                m = m ? '' + m + 'min' : '';

                return h + m + '\n\n' + label;
            }
        );
    },

    show_mode__search: function () {
        let actors = [this.entry, this.search_results_container];

        this._set_mode(
            this.mode.SEARCH,
            null,
            () => {
                this.search_results_content.destroy_all_children();
                actors.forEach((it) => it.hide());
                this.single_mode_icon.show();
                this.top_box.layout_manager.homogeneous = false;
                this.entry.set_text('');
                this.selected_search_result = null;
            }
        );

        actors.forEach((it) => it.show());
        this.single_mode_icon.hide();
        this.top_box.layout_manager.homogeneous = true; // center entry
        this.nav_bar.get_children().forEach((it) => it.checked = false);
        Mainloop.idle_add(() => this.entry.grab_key_focus());
    },

    show_mode__banner: function (text) {
        this._set_mode(
            this.mode.BANNER,
            null,
            () => {
                this.set_banner_size(0);
                this.nav_bar.show();
            }
        );

        this.nav_bar.hide();
        this.set_banner_size(.2);
        this.set_banner_text(text);
    },

    // A very simple way of handling different 'modes' (views) of the stats
    // interface.
    //
    // There is one 'show_mode__' func for each mode, which needs to call this
    // func.
    //
    // We maintain the args passed to a particular 'show_mode__' func so that
    // it's possible to refresh the mode by calling it with the same args
    // (e.g., when the css custom props have been updated.) Or we could slightly
    // tweak the args and refresh (e.g., change the keyword, but keep month
    // the same for the SINGLE mode.)
    //
    // @mode_name     : string (use this.mode enum only)
    // @args          : array  (of the args passed to a 'show_mode__' func)
    // @hide_callback : func   (used to close the prev mode)
    _set_mode: function (name, args, hide_callback) {
        this.prev_mode = this.current_mode;

        this.current_mode = {
            name          : name,
            args          : args,
            hide_callback : hide_callback,
        };

        if (typeof this.prev_mode.hide_callback === 'function') {
            let focused_actor = this.prev_mode.name === this.current_mode.name ?
                                global.stage.get_key_focus() :
                                this.actor;

            this.prev_mode.hide_callback();
            Mainloop.idle_add(() => focused_actor.grab_key_focus());
        }
    },

    _get_stats__sum: function (keyword) {
        let sum = {
            today        : 0,
            week         : 0,
            month        : 0,
            three_months : 0,
            six_months   : 0,
            quarters     : new Map(),
            all          : 0,
        };

        let month_quarter_map = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3];

        let bound_dates = new Map([
            ['today'        , this.string_date_map.get('today')[1][0]],
            ['week'         , this.string_date_map.get('week')[1][0]],
            ['month'        , this.string_date_map.get('month')[1][0]],
            ['three_months' , this.string_date_map.get('three_months')[1][0]],
            ['six_months'   , this.string_date_map.get('six_months')[1][0]],
        ]);

        this.stats_data.forEach((records, date) => {
            let val = records.get(keyword) || 0;

            bound_dates.forEach((target_date, k) => {
                if (date >= target_date) sum[k] += val;
                else                     bound_dates.delete(k);
            });

            let year  = date.substr(0, 4);
            sum.all  += val;

            if (val > 0) {
                let quarter       = month_quarter_map[+(date.substr(5, 2))];
                let year_quarters = sum.quarters.get(year) || [0, 0, 0, 0];

                year_quarters[quarter] += val;
                sum.quarters.set(year, year_quarters);
            }
        });

        return sum;
    },

    _get_stats__vbars_single: function (year, month, keyword) {
        month++;

        let days_in_month = (new Date(year, month, 0)).getDate();

        let rgba = G.REG_PROJ.test(keyword) ?
                   this.graph_css['-timepp-proj-vbar-color'][1] :
                   this.graph_css['-timepp-task-vbar-color'][1];

        let vbars = new Array(days_in_month);

        for (let i = 0; i < days_in_month; i++) {
            let records =
                this.stats_data.get('%d-%02d-%02d'.format(year, month, i + 1));

            let found = records ? (records.get(keyword) || null) : null;

            vbars[i] = {
                label   : keyword,
                y_val   : found || 0,
                rgba    : rgba,
                x_label : '%02d'.format(i + 1),
            };
        }

        return vbars;
    },

    _get_stats__vbars_global: function (date) {
        let vbars   = [];
        let records = this.stats_data.get(date);

        if (records) {
            for (let [key, val] of records) {
                let rgba = G.REG_PROJ.test(key) ?
                           this.graph_css['-timepp-proj-vbar-color'][1] :
                           this.graph_css['-timepp-task-vbar-color'][1];

                vbars.push({
                    label   : key,
                    y_val   : val,
                    rgba    : rgba,
                    x_label : '',
                });
            }

            vbars.reverse(); // we want the projects to be at the start
        }

        return vbars;
    },

    // @direction: 1 or -1
    _navigate_search_results: function (direction) {
        if (this.search_results_content.get_n_children() < 2 ||
            !this.selected_search_result) {

            return;
        }

        let new_selected;

        if (direction === -1)
            new_selected = this.selected_search_result.get_next_sibling();
        else
            new_selected = this.selected_search_result.get_previous_sibling();

        if (! new_selected)
            return;

        this.selected_search_result.pseudo_class = '';
        new_selected.pseudo_class                = 'selected';
        this.selected_search_result              = new_selected;

        SCROLL_TO_ITEM.scroll(this.search_scrollview,
                              this.search_results_content,
                              new_selected);
    },

    _search: function () {
        this.search_results_content.destroy_all_children();
        this.search_scrollview.get_vscroll_bar().get_adjustment().set_value(0);
        if (this.selected_search_result)
            this.selected_search_result.pseudo_class = '';
        this.selected_search_result = null;

        let needle = this.entry.get_text().toLowerCase();


        if (! needle) return;


        let reduced_results = [];
        let score;

        for (let i = 0, len = this.stats_unique_entries.length; i < len; i++) {
            score = FUZZ.fuzzy_search_v1(
                needle, this.stats_unique_entries[i].toLowerCase());

            if (score !== null) reduced_results.push([i, score]);
        }


        if (reduced_results.length === 0)
            return;


        reduced_results.sort((a, b) => b[1] - a[1]);

        let len = Math.min(50, reduced_results.length);

        for (let i = 0; i < len; i++) {
            let label = new St.Label({ text: this.stats_unique_entries[reduced_results[i][0]], reactive: true, track_hover: true, style_class: 'search-result-item' });
            label.clutter_text.line_wrap      = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            label.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;

            label.connect('queue-redraw', () => {
                if (! this.search_scrollview.vscrollbar_visible)
                    RESIZE.resize_label(label);
            });

            label.connect('notify::hover', (label) => {
                this.selected_search_result.pseudo_class = '';
                this.selected_search_result = label;
                label.pseudo_class = 'selected';
            });

            label.connect('button-press-event', (label) => {
                let d = new Date();
                this.show_mode__single(
                    d.getFullYear(), d.getMonth(), label.get_text());
            });

            this.search_results_content.add_child(label);
        }

        this.selected_search_result =
            this.search_results_content.get_first_child();

        this.selected_search_result.pseudo_class = 'selected';
    },

    _on_month_picker_changed: function (date_arr, date_str) {
        switch (this.current_mode.name) {
            case this.mode.GLOBAL:
                this.show_mode__global(date_str);
                break;
            case this.mode.SINGLE:
                this.show_mode__single(
                    date_arr[0], date_arr[1], this.current_mode.args[2]);
                break;
        }
    },

    _update_string_date_map: function () {
        let today  = G.date_yyyymmdd();
        let date_o = new Date(today + 'T00:00:00');

        this.string_date_map.get('today')[1] = [today, today];

        let day_pos = (7 - Shell.util_get_week_start() + date_o.getDay()) % 7;
        date_o.setDate(date_o.getDate() - day_pos);
        this.string_date_map.get('week')[1] = [G.date_yyyymmdd(date_o), today];

        date_o.setDate(1);
        this.string_date_map.get('month')[1] =
            [today.substr(0, 7) + '-01', today];

        date_o.setMonth(date_o.getMonth() - 2);
        this.string_date_map.get('three_months')[1] =
            [G.date_yyyymmdd(date_o), today];

        date_o.setMonth(date_o.getMonth() - 3);
        this.string_date_map.get('six_months')[1] =
            [G.date_yyyymmdd(date_o), today];
    },

    _update_graph_css_info: function () {
        let update_needed = false;

        for (let prop in this.graph_css) {
            if (! this.graph_css.hasOwnProperty(prop)) continue;

            let [success, col] = this.vbars_graph.actor.get_theme_node()
                                 .lookup_color(prop, false);

            let hex = col.to_string();

            if (success) {
                let rgba = [
                    col.red   / 255,
                    col.green / 255,
                    col.blue  / 255,
                    col.alpha / 255,
                ];

                if (this.graph_css[prop][0] !== hex) {
                    update_needed = true;
                    this.graph_css[prop] = [hex, rgba];
                }
            }
        }

        if (update_needed) {
            this.vbars_graph.draw_coord_system({
                axes_rgba    : this.graph_css['-timepp-axes-color'][1],
                y_label_rgba : this.graph_css['-timepp-y-label-color'][1],
                x_label_rgba : this.graph_css['-timepp-x-label-color'][1],
                rulers_rgba  : this.graph_css['-timepp-rulers-color'][1],
            });

            if (this.current_mode.name) {
                this.mode_func_map[this.current_mode.name](
                    ...this.current_mode.args);
            }
        }
    },

    _on_new_day_started: function (today) {
        this.date_picker.set_range('',  today);
        this.bound_date_1.set_range('', today);
        this.bound_date_2.set_range('', today);
    },
});
