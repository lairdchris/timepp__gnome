const St        = imports.gi.St;
const Gio       = imports.gi.Gio
const Gtk       = imports.gi.Gtk;
const GLib      = imports.gi.GLib;
const Meta      = imports.gi.Meta;
const Shell     = imports.gi.Shell;
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


const FULLSCREEN    = ME.imports.lib.fullscreen;
const SIG_MANAGER   = ME.imports.lib.signal_manager;
const KEY_MANAGER   = ME.imports.lib.keybinding_manager;
const PANEL_ITEM    = ME.imports.lib.panel_item;


const IFACE = `${ME.path}/dbus/stopwatch_iface.xml`;


const CACHE_FILE = GLib.get_home_dir() +
                   '/.cache/timepp_gnome_shell_extension/timepp_stopwatch.json';


const StopwatchState = {
    RUNNING : 'RUNNING',
    STOPPED : 'STOPPED',
    RESET   : 'RESET',
};

const ClockFormat = {
    H_M      : 0,
    H_M_S    : 1,
    H_M_S_CS : 2,
};

const NotifStyle = {
    STANDARD   : 0,
    FULLSCREEN : 1,
};


// =====================================================================
// @@@ Main
//
// @ext      : obj (main extension object)
// @settings : obj (extension settings)
//
// @signals: 'section-open-state-changed'
// =====================================================================
var Stopwatch = new Lang.Class({
    Name: 'Timepp.Stopwatch',

    _init: function (ext, settings) {
        this.ext      = ext;
        this.settings = settings;


        {
            let [,xml,] = Gio.file_new_for_path(IFACE).load_contents(null);
            xml = '' + xml;
            this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(xml, this);
        }


        this.section_enabled = this.settings.get_boolean('stopwatch-enabled');
        this.separate_menu   = this.settings.get_boolean('stopwatch-separate-menu');
        this.clock_format    = this.settings.get_enum('stopwatch-clock-format');
        this.start_time      = 0; // for computing elapsed time (microseconds)
        this.cache_file      = null;
        this.cache           = null;
        this.tic_mainloop_id = null;
        this.time_backup_mainloop_id = null;


        this.fullscreen = new StopwatchFullscreen(this.ext, this,
            this.settings.get_int('stopwatch-fullscreen-monitor-pos'));


        this.sigm = new SIG_MANAGER.SignalManager();
        this.keym = new KEY_MANAGER.KeybindingManager(this.settings);


        //
        // register shortcuts (need to be enabled later on)
        //
        this.keym.register('stopwatch-keybinding-open', () => {
             this.ext.open_menu(this);
        });
        this.keym.register('stopwatch-keybinding-open-fullscreen', () => {
            this.show_fullscreen();
        });


        //
        // panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);
        this.panel_item.icon.icon_name = 'timepp-stopwatch-symbolic';

        this.panel_item.actor.add_style_class_name('stopwatch-panel-item');
        this._toggle_panel_mode();

        ext.panel_item_box.add_actor(this.panel_item.actor);


        switch (this.clock_format) {
            case ClockFormat.H_M:
                this.panel_item.set_label('00:00');
                this.fullscreen.set_banner_text('00:00')
                break;
            case ClockFormat.H_M_S:
                this.panel_item.set_label('00:00:00');
                this.fullscreen.set_banner_text('00:00:00')
                break;
            case ClockFormat.H_M_S_CS:
                this.panel_item.set_label('00:00:00.00');
                this.fullscreen.set_banner_text('00:00:00.00')
                break;
        }


        //
        // section
        //
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section stopwatch-section' });


        //
        // header
        //
        this.header = new PopupMenu.PopupMenuItem(_('Stopwatch'), { hover: false, activate: false, style_class: 'header' });
        this.header.actor.can_focus = false;
        this.header.label.add_style_class_name('clock');
        this.actor.add_child(this.header.actor);

        this.icon_box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header.actor.add(this.icon_box, {expand: true});

        this.fullscreen_bin  = new St.Button({ can_focus: true, y_align: St.Align.MIDDLE, x_align: St.Align.END, style_class: 'fullscreen-icon' });
        this.icon_box.add(this.fullscreen_bin);
        this.fullscreen_icon = new St.Icon({ icon_name: 'timepp-fullscreen-symbolic' });
        this.fullscreen_bin.add_actor(this.fullscreen_icon);


        //
        // buttons
        //
        let btn_box_wrapper = new PopupMenu.PopupMenuItem('', { hover: false, activate: false });
        this.actor.add_actor(btn_box_wrapper.actor);
        btn_box_wrapper.label.hide();
        btn_box_wrapper.actor.can_focus = false;

        this.stopwatch_button_box = new St.BoxLayout({ style_class: 'btn-box' });
        btn_box_wrapper.actor.add(this.stopwatch_button_box, {expand: true});


        this.button_reset = new St.Button({ can_focus: true, label: _('Reset'), style_class: 'btn-reset button', x_expand: true, visible: false });
        this.button_lap   = new St.Button({ can_focus: true, label: _('Lap'),   style_class: 'btn-lap button',   x_expand: true, visible: false });
        this.button_start = new St.Button({ can_focus: true, label: _('Start'), style_class: 'btn-start button', x_expand: true });
        this.button_stop  = new St.Button({ can_focus: true, label: _('Stop'), style_class: 'btn-stop button',  x_expand: true, visible: false });
        this.stopwatch_button_box.add(this.button_reset, {expand: true});
        this.stopwatch_button_box.add(this.button_lap, {expand: true});
        this.stopwatch_button_box.add(this.button_start, {expand: true});
        this.stopwatch_button_box.add(this.button_stop, {expand: true});


        //
        // laps box
        //
        this.laps_wrapper = new PopupMenu.PopupMenuItem('', { hover: false, activate: false });
        this.actor.add(this.laps_wrapper.actor, {expand: true});
        this.laps_wrapper.actor.can_focus = false;
        this.laps_wrapper.label.hide();
        this.laps_wrapper.actor.hide();

        this.laps_scroll = new St.ScrollView({ style_class: 'laps-scrollview vfade', x_fill: true, y_fill: false, y_align: St.Align.START});
        this.laps_wrapper.actor.add(this.laps_scroll, {expand: true});

        this.laps_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.laps_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.laps_scroll_bin = new St.BoxLayout({ vertical: true, style_class: 'laps-box' });
        this.laps_scroll.add_actor(this.laps_scroll_bin);

        this.laps_string = new St.Label();
        this.laps_scroll_bin.add_actor(this.laps_string);


        //
        // listen
        //
        this.sigm.connect(this.fullscreen, 'monitor-changed', () => {
            this.settings.set_int('stopwatch-fullscreen-monitor-pos', this.fullscreen.monitor);
        });
        this.sigm.connect(this.settings, 'changed::stopwatch-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('stopwatch-separate-menu');
            this.ext.update_panel_items();
        });
        this.sigm.connect(this.settings, 'changed::stopwatch-clock-format', () => {
            this.clock_format = this.settings.get_enum('stopwatch-clock-format');
            let txt = this._time_format_str();
            this.panel_item.set_label(txt);
            this.fullscreen.set_banner_text(txt);
        });
        this.sigm.connect(this.settings, 'changed::stopwatch-panel-mode', () => {
            this._toggle_panel_mode();
        });
        this.sigm.connect(this.panel_item.actor, 'key-focus-in', () => {
            // user has right-clicked to show the context menu
            if (this.ext.menu.isOpen && this.ext.context_menu.actor.visible)
                return;

            this.ext.open_menu(this);
        });
        this.sigm.connect(this.panel_item, 'left-click', () => this.ext.toggle_menu(this));
        this.sigm.connect(this.panel_item, 'right-click', () => this.ext.toggle_context_menu(this));
        this.sigm.connect(this.panel_item, 'middle-click', () => this.stopwatch_toggle());
        this.sigm.connect_press(this.fullscreen_bin, () => this.show_fullscreen());
        this.sigm.connect_press(this.button_start, () => this.start());
        this.sigm.connect_press(this.button_reset, () => this.reset());
        this.sigm.connect_press(this.button_stop, () => this.stop());
        this.sigm.connect_press(this.button_lap, () => this.lap());
        this.sigm.connect(this.laps_string, 'queue-redraw', () => {
            this.laps_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar())
                this.laps_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });


        //
        // Init the rest of the section or disconnect signals for now.
        //
        if (this.section_enabled) this.enable_section();
        else                      this.sigm.disconnect_all();
    },

    on_section_open_state_changed: function (state) {
        if (state) {
            this.panel_item.actor.add_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = false;
        }
        else {
            this.panel_item.actor.remove_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = true;
        }

        this.emit('section-open-state-changed', state);
    },

    toggle_section: function () {
        if (this.section_enabled) this.disable_section();
        else                      this.enable_section();

        this.section_enabled = this.settings.get_boolean('stopwatch-enabled');
        this.ext.update_panel_items();
    },

    disable_section: function () {
        if (this.time_backup_mainloop_id) {
            Mainloop.source_remove(this.time_backup_mainloop_id);
            this.time_backup_mainloop_id = null;
        }

        if (this.cache.state === StopwatchState.RUNNING) this.stop();
        this.dbus_impl.unexport();
        this._store_cache();
        this.sigm.disconnect_all();
        this.keym.disable_all();

        if (this.fullscreen) {
            this.fullscreen.destroy();
            this.fullscreen = null;
        }
    },

    enable_section: function () {
        // init cache file
        try {
            this.cache_file = Gio.file_new_for_path(CACHE_FILE);

            let cache_format_version =
                ME.metadata['cache-file-format-version'].stopwatch;

            if (this.cache_file.query_exists(null)) {
                let [a, contents, b] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(contents);
            }

            if (!this.cache || !this.cache.format_version ||
                this.cache.format_version !== cache_format_version) {

                this.cache = {
                    format_version : cache_format_version,
                    state          : StopwatchState.RESET,
                    time           : 0, // microseconds
                    laps           : [],
                };
            }
        }
        catch (e) {
            logError(e);
            return;
        }

        if (! this.fullscreen) {
            this.fullscreen = new StopwatchFullscreen(
                this.ext, this, this.settings.get_int('stopwatch-fullscreen-monitor-pos'));
        }

        this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/Stopwatch');
        this.sigm.connect_all();
        this.keym.enable_all();


        if (this.cache.state === StopwatchState.RESET) return;


        this._update_laps();
        this._update_time_display();

        if (this.cache.state === StopwatchState.RUNNING) this.start();
        else                                             this.stop();
    },

    _store_cache: function () {
        if (! this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    start: function () {
        this.start_time = GLib.get_monotonic_time() - this.cache.time;

        if (!this.fullscreen.is_open && this.actor.visible)
            this.button_stop.grab_key_focus();

        this.cache.state = StopwatchState.RUNNING;
        this._toggle_buttons();
        this._panel_item_UI_update();
        this.fullscreen.on_timer_started();

        if (! this.time_backup_mainloop_id) this._periodic_time_backup();

        this._store_cache();
        this._tic();
    },

    stop: function () {
        this.cache.time = GLib.get_monotonic_time() - this.start_time;

        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (this.time_backup_mainloop_id) {
            Mainloop.source_remove(this.time_backup_mainloop_id);
            this.time_backup_mainloop_id = null;
        }

        this.fullscreen.on_timer_stopped();

        if (!this.fullscreen.is_open && this.actor.visible)
            this.button_start.grab_key_focus();

        this.cache.state = StopwatchState.STOPPED;
        this._panel_item_UI_update();
        this._toggle_buttons();

        this._store_cache();
    },

    reset: function () {
        if (this.tic_mainloop_id) {
            Mainloop.source_remove(this.tic_mainloop_id);
            this.tic_mainloop_id = null;
        }

        if (this.time_backup_mainloop_id) {
            Mainloop.source_remove(this.time_backup_mainloop_id);
            this.time_backup_mainloop_id = null;
        }

        this.fullscreen.on_timer_reset();

        if (!this.fullscreen.is_open && this.actor.visible)
            this.button_start.grab_key_focus();

        this.cache.state = StopwatchState.RESET;
        this.cache.laps = [];
        this.cache.time = 0;
        this._store_cache();
        this._update_time_display();
        this._toggle_buttons();
        this._panel_item_UI_update();
        this._destroy_laps();
        this.header.label.text = _('Stopwatch');
    },

    stopwatch_toggle: function () {
        if (this.cache.state === StopwatchState.RUNNING)
            this.stop();
        else
            this.start();
    },

    _tic: function () {
        this.cache.time = GLib.get_monotonic_time() - this.start_time;

        this._update_time_display();

        if (this.clock_format === ClockFormat.H_M_S_CS) {
            this.tic_mainloop_id = Mainloop.timeout_add(10, () => {
                this._tic();
            });
        }
        else {
            this.tic_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
                this._tic();
            });
        }
    },

    _update_time_display: function () {
        let txt = this._time_format_str();

        this.header.label.text = txt;
        this.panel_item.set_label(txt);
        this.fullscreen.set_banner_text(txt);
    },

    _time_format_str: function () {
        let t   = Math.floor(this.cache.time / 10000); // centiseconds

        let cs  = t % 100;
        t       = Math.floor(t / 100);
        let h   = Math.floor(t / 3600);
        t       = t % 3600;
        let m   = Math.floor(t / 60);
        let s   = t % 60;

        switch (this.clock_format) {
            case ClockFormat.H_M:
                return "%02d:%02d".format(h, m);
            case ClockFormat.H_M_S:
                return "%02d:%02d:%02d".format(h, m, s);
            case ClockFormat.H_M_S_CS:
                return "%02d:%02d:%02d.%02d".format(h, m, s, cs);
        }
    },

    _panel_item_UI_update: function () {
        if (this.cache.state === StopwatchState.RUNNING)
            this.panel_item.actor.add_style_class_name('on');
        else
            this.panel_item.actor.remove_style_class_name('on');
    },

    lap: function () {
        if (this.cache.state !== StopwatchState.RUNNING) return;

        this.cache.laps.push(this._time_format_str());
        this._store_cache();
        this._update_laps();
    },

    _update_laps: function () {
        let n = this.cache.laps.length;

        if (n === 0) return;

        let pad    = String(n).length + 1;
        let markup = '';

        while (n--) {
            markup += `<b>${n + 1}</b> ` +
                      Array(pad - String(n + 1).length).join(' ') +
                      `- ${this.cache.laps[n]}\n`;
        }

        markup = `<tt>${markup.slice(0, -1)}</tt>`;

        this.laps_string.clutter_text.set_markup(markup);
        this.fullscreen.laps_string.clutter_text.set_markup(markup);
        this.laps_wrapper.actor.show();
        this.fullscreen.laps_scroll.show();
    },

    _destroy_laps: function () {
        this.laps_wrapper.actor.hide();
        this.laps_string.text = '';
    },

    _toggle_buttons: function () {
        switch (this.cache.state) {
            case StopwatchState.RESET:
                this.button_reset.hide();
                this.button_lap.hide();
                this.button_start.show();
                this.button_stop.hide();
                this.button_start.add_style_pseudo_class('first-child');
                this.button_start.add_style_pseudo_class('last-child');
                this.fullscreen.button_reset.hide();
                this.fullscreen.button_lap.hide();
                this.fullscreen.button_start.show();
                this.fullscreen.button_stop.hide();
                this.fullscreen.button_start.add_style_pseudo_class('first-child');
                this.fullscreen.button_start.add_style_pseudo_class('last-child');
                break;
            case StopwatchState.RUNNING:
                this.button_reset.show();
                this.button_lap.show();
                this.button_start.hide();
                this.button_stop.show();
                this.fullscreen.button_reset.show();
                this.fullscreen.button_lap.show();
                this.fullscreen.button_start.hide();
                this.fullscreen.button_stop.show();
                break;
            case StopwatchState.STOPPED:
                this.button_reset.show();
                this.button_lap.hide();
                this.button_start.show();
                this.button_stop.hide();
                this.button_start.remove_style_pseudo_class('first-child');
                this.button_start.add_style_pseudo_class('last-child');
                this.fullscreen.button_reset.show();
                this.fullscreen.button_lap.hide();
                this.fullscreen.button_start.show();
                this.fullscreen.button_stop.hide();
                this.fullscreen.button_start.remove_style_pseudo_class('first-child');
                this.fullscreen.button_start.add_style_pseudo_class('last-child');
                break;
        }
    },

    show_fullscreen: function () {
        this.ext.menu.close();

        if (! this.fullscreen) {
            this.fullscreen = new StopwatchFullscreen(this.ext, this,
                this.settings.get_int('stopwatch-fullscreen-monitor-pos'));
        }

        this.fullscreen.open();
    },

    _periodic_time_backup: function () {
        this.cache.time = GLib.get_monotonic_time() - this.start_time;
        this._store_cache();

        this.time_backup_mainloop_id =
            Mainloop.timeout_add_seconds(60, () => {
                this._periodic_time_backup();
            });
    },

    _toggle_panel_mode: function () {
        if (this.settings.get_enum('stopwatch-panel-mode') === 0)
            this.panel_item.set_mode('icon');
        else if (this.settings.get_enum('stopwatch-panel-mode') === 1)
            this.panel_item.set_mode('text');
        else
            this.panel_item.set_mode('icon_text');
    },

    // returns int (microseconds)
    get_time: function () {
        if (this.cache.state === StopwatchState.RUNNING)
            return GLib.get_monotonic_time() - this.start_time;
        else
            return this.cache.time;
    },
});
Signals.addSignalMethods(Stopwatch.prototype);



// =====================================================================
// @@@ Stopwatch fullscreen interface
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @monitor  : int
//
// signals: 'monitor-changed'
// =====================================================================
const StopwatchFullscreen = new Lang.Class({
    Name    : 'Timepp.StopwatchFullscreen',
    Extends : FULLSCREEN.Fullscreen,

    _init: function (ext, delegate, monitor) {
        this.parent(monitor);
        this.middle_box.vertical = false;

        this.ext      = ext;
        this.delegate = delegate;

        this.default_style_class = this.actor.style_class;


        //
        // laps box
        //
        this.laps_scroll = new St.ScrollView({ visible: false, x_fill: true, y_fill: true, y_align: St.Align.START, style_class: 'laps-scrollview vfade' });
        this.middle_box.add_child(this.laps_scroll);

        this.laps_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.laps_scroll_bin = new St.BoxLayout({ vertical: true, style_class: 'laps-box' });
        this.laps_scroll.add_actor(this.laps_scroll_bin);

        this.laps_string = new St.Label();
        this.laps_scroll_bin.add_actor(this.laps_string);


        //
        // buttons
        //
        this.stopwatch_button_box = new St.BoxLayout({ x_expand: true, y_expand: true, style_class: 'btn-box', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, });
        this.bottom_box.add_child(this.stopwatch_button_box);


        this.button_reset = new St.Button({ can_focus: true, label: _('Reset'), style_class: 'btn-reset button', visible: false });
        this.button_lap   = new St.Button({ can_focus: true, label: _('Lap'),   style_class: 'btn-lap button',   visible: false });
        this.button_stop  = new St.Button({ can_focus: true, label: _('Stop'), style_class: 'btn-stop button',  visible: false });
        this.button_start = new St.Button({ can_focus: true, label: _('Start'), style_class: 'btn-start button' });
        this.stopwatch_button_box.add_child(this.button_reset);
        this.stopwatch_button_box.add_child(this.button_lap);
        this.stopwatch_button_box.add_child(this.button_start);
        this.stopwatch_button_box.add_child(this.button_stop);


        //
        // listen
        //
        this.button_start.connect('clicked', () => {
            this.delegate.start();
            return Clutter.EVENT_STOP;
        });
        this.button_reset.connect('clicked', () => {
            this.delegate.reset();
            return Clutter.EVENT_STOP;
        });
        this.button_stop.connect('clicked', () => {
            this.delegate.stop();
            return Clutter.EVENT_STOP;
        });
        this.button_lap.connect('clicked', () => {
            this.delegate.lap();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('key-release-event', (_, event) => {
            switch (event.get_key_symbol()) {
                case Clutter.KEY_space:
                    this.delegate.stopwatch_toggle();
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_l:
                case Clutter.KEY_KP_Enter:
                case Clutter.KEY_ISO_Enter:
                case Clutter.Return:
                    this.delegate.lap();
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_r:
                case Clutter.KEY_BackSpace:
                    this.delegate.reset();
                    return Clutter.EVENT_STOP;
                default:
                    return Clutter.EVENT_PROPAGATE;
            }
        });
    },

    close: function () {
        if (this.delegate.cache.state === StopwatchState.RESET) {
            this.actor.style_class = this.default_style_class;

            switch (this.delegate.clock_format) {
                case ClockFormat.H_M:
                    this.set_banner_text('00:00')
                    break;
                case ClockFormat.H_M_S:
                    this.set_banner_text('00:00:00')
                    break;
                case ClockFormat.H_M_S_CS:
                    this.set_banner_text('00:00:00.00')
                    break;
            }
        }

        this.parent();
    },

    on_timer_started: function () {
        this.actor.style_class = this.default_style_class;
    },

    on_timer_stopped: function () {
        this.actor.style_class = this.default_style_class + ' timer-stopped';
    },

    on_timer_reset: function () {
        this.laps_scroll.hide();
        this.laps_string.text = '';
    },
});
Signals.addSignalMethods(StopwatchFullscreen.prototype);
