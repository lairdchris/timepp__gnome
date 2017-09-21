const Gio  = imports.gi.Gio;
const Gtk  = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const Lang = imports.lang;


const ME = imports.misc.extensionUtils.getCurrentExtension();


const Gettext = imports.gettext;
Gettext.bindtextdomain(ME.metadata['gettext-domain'], ME.path + '/locale');
const _ = Gettext.domain(ME.metadata['gettext-domain']).gettext;


const Settings = new Lang.Class({
    Name: 'Timepp.Settings',

    _init: function () {
        {
            let GioSSS = Gio.SettingsSchemaSource;
            let schema = GioSSS.new_from_directory(
                ME.path + '/data/schemas', GioSSS.get_default(), false);
            schema = schema.lookup('org.gnome.shell.extensions.timepp', true);

            this.settings = new Gio.Settings({ settings_schema: schema });
        }

        this.builder = new Gtk.Builder();

        this.builder.set_translation_domain(ME.metadata['gettext-domain']);
        this.builder.add_from_file(ME.path + '/data/prefs.ui');

        this.selected_row = null;


        this.widget             = this.builder.get_object('settings_widget');
        this.add_dialog_content = this.builder.get_object('add-dialog-content');
        this.list_store         = this.builder.get_object('list-store');
        this.todo_name_entry    = this.builder.get_object('todo-name-entry');
        this.todo_file_chooser  = this.builder.get_object('todo-file-chooser');
        this.done_file_chooser  = this.builder.get_object('done-file-chooser');
        this.csv_dir_chooser    = this.builder.get_object('csv-dir-chooser');
        this.tree_add_button    = this.builder.get_object('tree-add-button');
        this.tree_remove_button = this.builder.get_object('tree-remove-button');
        this.tree_edit_button   = this.builder.get_object('tree-edit-button');


        this._bind_settings();


        //
        // listen
        //
        this.builder.get_object('treeview-selection')
        .connect('changed', (selection) => {
            this.selected_row =
                selection.get_selected_rows(this.list_store)[0][0];

            this.tree_remove_button.sensitive = Boolean(this.selected_row);
            this.tree_edit_button.sensitive   = Boolean(this.selected_row);
        });

        this.tree_add_button.connect('clicked', () => {
            this._show_dialog();
        });

        this.tree_edit_button.connect('clicked', () => {
            let [success, iter] = this.list_store.get_iter(this.selected_row);

            this._show_dialog({
                iter      : iter,
                name      : this.list_store.get_value(iter, 0),
                todo_file : this.list_store.get_value(iter, 1),
                done_file : this.list_store.get_value(iter, 2),
                csv_dir   : this.list_store.get_value(iter, 3),
            });
        });

        this.tree_remove_button.connect('clicked', () => {
            let todo_files = this.settings.get_value('todo-files').deep_unpack();
            let [success, iter] = this.list_store.get_iter(this.selected_row);
            let name = this.list_store.get_value(iter, 0);
            let current = this.settings.get_value('todo-current').deep_unpack();

            for (let i = 0; i < todo_files.length; i++) {
                if (todo_files[i].name === name)
                    todo_files.splice(i, 1);
            }

            this.list_store.remove(iter);
            this.settings.set_value('todo-files',
                                    GLib.Variant.new('aa{ss}', todo_files));

            if (current.name === name) {
                if (todo_files.length > 0) {
                    this.settings.set_value('todo-current',
                                             GLib.Variant.new('a{ss}', todo_files[0]));
                }
                else {
                    this.settings.set_value('todo-current',
                                            GLib.Variant.new('a{ss}', {}));
                }
            }
        });
    },

    _show_dialog: function (todo_entry) {
        let dialog = new Gtk.Dialog({
            title: '',
            transient_for: this.widget.get_toplevel(),
            use_header_bar: true,
            modal: true,
        });

        if (todo_entry) {
            this.todo_name_entry.set_text(todo_entry.name);
            this.todo_file_chooser.set_uri(todo_entry.todo_file);
            this.done_file_chooser.set_uri(todo_entry.done_file);
            this.csv_dir_chooser.set_uri(todo_entry.csv_dir);
        }


        let todo_files = this.settings.get_value('todo-files').deep_unpack();


        //
        // headerbar buttons
        //
        let header_bar = dialog.get_header_bar();

        header_bar.show_close_button = false;

        let cancel_button = new Gtk.Button({ label: _('Cancel') });
        let ok_button    = new Gtk.Button({ label: _('Ok'), sensitive: false });

        header_bar.pack_start(cancel_button);
        header_bar.pack_end(ok_button);

        dialog.get_content_area().add(this.add_dialog_content);


        //
        // listen
        //
        let file_chooser_signal_id =
        this.todo_file_chooser.connect('selection-changed', () => {
            if (this.todo_name_entry.get_text() &&
                this.todo_file_chooser.get_uri()) {

                ok_button.sensitive = true;
                ok_button.get_style_context().add_class('suggested-action');
            }
            else {
                ok_button.sensitive = false;
                ok_button.get_style_context().remove_class('suggested-action');
            }
        });

        let name_entry_signal_id =
        this.todo_name_entry.connect('changed', () => {
            let text = this.todo_name_entry.get_text();

            if (text && this.todo_file_chooser.get_uri()) {
                ok_button.sensitive = true;
                ok_button.get_style_context().add_class('suggested-action');
            }
            else {
                ok_button.sensitive = false;
                ok_button.get_style_context().remove_class('suggested-action');
            }

            this.todo_name_entry['secondary-icon-name'] = null;

            for (let i = 0; i < todo_files.length; i++) {
                if (todo_files[i].name === text) {
                    if (todo_entry && todo_entry.name === text) break;

                    ok_button.sensitive = false;
                    this.todo_name_entry['secondary-icon-name'] =
                        'dialog-warning-symbolic';
                }
            }
        });

        ok_button.connect('clicked', () => {
            let result = {
                'name'      : this.todo_name_entry.get_text(),
                'todo_file' : this.todo_file_chooser.get_uri(),
                'done_file' : (this.done_file_chooser.get_uri() || ''),
                'csv_dir'   : (this.csv_dir_chooser.get_uri()   || ''),
            };

            let current_todo = this.settings.get_value('todo-current')
                               .deep_unpack();

            if (todo_entry) {
                this.list_store.set_value(todo_entry.iter, 0, result.name);
                this.list_store.set_value(todo_entry.iter, 1, result.todo_file);
                this.list_store.set_value(todo_entry.iter, 2, result.done_file);
                this.list_store.set_value(todo_entry.iter, 3, result.csv_dir);

                for (let i = 0; i < todo_files.length; i++) {
                    if (todo_files[i].name === todo_entry.name)
                        todo_files[i] = result;
                }

                if (todo_entry.name === current_todo.name) {
                    this.settings.set_value('todo-current',
                                            GLib.Variant.new('a{ss}', result));
                }
            }
            else {
                let iter = this.list_store.append();

                this.list_store.set_value(iter, 0, result.name);
                this.list_store.set_value(iter, 1, result.todo_file);
                this.list_store.set_value(iter, 2, result.done_file);
                this.list_store.set_value(iter, 3, result.csv_dir);

                todo_files.push(result);

                if (!current_todo.name) {
                    this.settings.set_value('todo-current',
                                            GLib.Variant.new('a{ss}', result));
                }
            }

            this.settings.set_value('todo-files', GLib.Variant.new('aa{ss}', todo_files));

            dialog.get_content_area().remove(this.add_dialog_content);
            this.todo_name_entry.disconnect(name_entry_signal_id);
            this.todo_file_chooser.disconnect(file_chooser_signal_id);
            this._reset_add_dialog();
            dialog.destroy();
        });

        cancel_button.connect('clicked', () => {
            dialog.get_content_area().remove(this.add_dialog_content);
            this.todo_name_entry.disconnect(name_entry_signal_id);
            this.todo_file_chooser.disconnect(file_chooser_signal_id);
            this._reset_add_dialog();
            dialog.destroy();
        });

        dialog.connect('response', () => {
            dialog.get_content_area().remove(this.add_dialog_content);
            this.todo_name_entry.disconnect(name_entry_signal_id);
            this.todo_file_chooser.disconnect(file_chooser_signal_id);
            this._reset_add_dialog();
        });


        //
        // show
        //
        dialog.show_all();
    },

    _reset_add_dialog: function () {
        this.todo_name_entry.set_text('');
        this.todo_file_chooser.unselect_all();
        this.done_file_chooser.unselect_all();

        // @HACK
        // There appears to be no other way to reset a gtk_file_chooser that is
        // used for folder selecting.
        this.csv_dir_chooser.set_uri('');
    },

    // Bind the gtk window to the schema settings
    _bind_settings: function () {
        //
        // General
        //
        this.settings.bind(
            'unicon-mode',
            this.builder.get_object('unicon-mode-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('panel-item-position-combo')
            .set_active(this.settings.get_enum('panel-item-position'));
        this.builder.get_object('panel-item-position-combo').connect('changed',
            (widget) => {
                this.settings.set_enum('panel-item-position', widget.get_active());
            });

        this.settings.bind(
            'timer-enabled',
            this.builder.get_object('timer-enable-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'stopwatch-enabled',
            this.builder.get_object('stopwatch-enable-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'pomodoro-enabled',
            this.builder.get_object('pomodoro-enable-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'alarms-enabled',
            this.builder.get_object('alarms-enable-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'todo-enabled',
            this.builder.get_object('todo-enable-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);


        //
        // Timer
        //
        this.settings.bind(
            'timer-separate-menu',
            this.builder.get_object('timer-separate-menu-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'timer-show-seconds',
            this.builder.get_object('timer-show-seconds-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('timer-panel-mode-combo')
            .set_active(this.settings.get_enum('timer-panel-mode'));
        this.builder.get_object('timer-panel-mode-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('timer-panel-mode', widget.get_active());
            });

        {
            let sound_f = this.settings.get_string('timer-sound-file-path');

            if (! GLib.file_test(sound_f, GLib.FileTest.EXISTS)) {
                this.settings.set_string('timer-sound-file-path',
                    GLib.filename_to_uri(ME.path + '/data/sounds/beeps.ogg', null));
            }
        }
        this.builder.get_object('timer-sound-chooser')
            .set_uri(this.settings.get_string('timer-sound-file-path'), null);
        this.builder.get_object('timer-sound-chooser')
            .connect('selection-changed', (widget) => {
                this.settings.set_string('timer-sound-file-path', widget.get_uri());
            });

        this.builder.get_object('timer-notif-style-combo')
            .set_active(this.settings.get_enum('timer-notif-style'));
        this.builder.get_object('timer-notif-style-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('timer-notif-style', widget.get_active());
            });

        this.settings.bind(
            'timer-play-sound',
            this.builder.get_object('timer-play-sound-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'timer-keybinding-open',
            this.builder.get_object('timer-keybinding-open'),
            'text',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('timer-keybinding-open')
            .set_text(this.settings.get_strv('timer-keybinding-open')[0]);
        this.builder.get_object('timer-keybinding-open')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('timer-keybinding-open', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('timer-keybinding-open', ['']);
                }
            });

        this.builder.get_object('timer-keybinding-open-fullscreen')
            .set_text(this.settings.get_strv('timer-keybinding-open-fullscreen')[0]);
        this.builder.get_object('timer-keybinding-open-fullscreen')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('timer-keybinding-open-fullscreen', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('timer-keybinding-open-fullscreen', ['']);
                }
            });


        //
        // Stopwatch
        //
        this.settings.bind(
            'stopwatch-separate-menu',
            this.builder.get_object('stopwatch-separate-menu-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('stopwatch-clock-format-combo')
            .set_active(this.settings.get_enum('stopwatch-clock-format'));
        this.builder.get_object('stopwatch-clock-format-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('stopwatch-clock-format', widget.get_active());
            });

        this.builder.get_object('stopwatch-panel-mode-combo')
            .set_active(this.settings.get_enum('stopwatch-panel-mode'));
        this.builder.get_object('stopwatch-panel-mode-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('stopwatch-panel-mode', widget.get_active());
            });

        this.builder.get_object('stopwatch-keybinding-open')
            .set_text(this.settings.get_strv('stopwatch-keybinding-open')[0]);
        this.builder.get_object('stopwatch-keybinding-open')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('stopwatch-keybinding-open', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('stopwatch-keybinding-open', ['']);
                }
            });

        this.builder.get_object('stopwatch-keybinding-open-fullscreen')
            .set_text(this.settings.get_strv('stopwatch-keybinding-open-fullscreen')[0]);
        this.builder.get_object('stopwatch-keybinding-open-fullscreen')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('stopwatch-keybinding-open-fullscreen', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('stopwatch-keybinding-open-fullscreen', ['']);
                }
            });


        //
        // Pomodoro
        //
        this.settings.bind(
            'pomodoro-separate-menu',
            this.builder.get_object('pomodoro-separate-menu-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'pomodoro-show-seconds',
            this.builder.get_object('pomodoro-show-seconds-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('pomodoro-panel-mode-combo')
            .set_active(this.settings.get_enum('pomodoro-panel-mode'));
        this.builder.get_object('pomodoro-panel-mode-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('pomodoro-panel-mode', widget.get_active());
            });

        {
            let sound_f = this.settings.get_string('pomodoro-sound-file-path');

            if (! GLib.file_test(sound_f, GLib.FileTest.EXISTS)) {
                this.settings.set_string('pomodoro-sound-file-path',
                    GLib.filename_to_uri(ME.path + '/data/sounds/beeps.ogg', null));
            }
        }
        this.builder.get_object('pomodoro-sound-chooser')
            .set_uri(this.settings.get_string('pomodoro-sound-file-path'), null);
        this.builder.get_object('pomodoro-sound-chooser')
            .connect('selection-changed', (widget) => {
                this.settings.set_string('pomodoro-sound-file-path', widget.get_uri());
            });

        this.builder.get_object('pomodoro-notif-style-combo')
            .set_active(this.settings.get_enum('pomodoro-notif-style'));
        this.builder.get_object('pomodoro-notif-style-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('pomodoro-notif-style', widget.get_active());
            });

        this.settings.bind(
            'pomodoro-play-sound',
            this.builder.get_object('pomodoro-play-sound-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.settings.bind(
            'pomodoro-stop-tracking',
            this.builder.get_object('pomodoro-stop-tracking-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('pomodoro-keybinding-open')
            .set_text(this.settings.get_strv('pomodoro-keybinding-open')[0]);
        this.builder.get_object('pomodoro-keybinding-open')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('pomodoro-keybinding-open', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('pomodoro-keybinding-open', ['']);
                }
            });

        this.builder.get_object('pomodoro-keybinding-open-fullscreen')
            .set_text(this.settings.get_strv('pomodoro-keybinding-open-fullscreen')[0]);
        this.builder.get_object('pomodoro-keybinding-open-fullscreen')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('pomodoro-keybinding-open-fullscreen', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('pomodoro-keybinding-open-fullscreen', ['']);
                }
            });


        //
        // Alarms
        //
        this.settings.bind(
            'alarms-separate-menu',
            this.builder.get_object('alarms-separate-menu-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        {
            let sound_f = this.settings.get_string('alarms-sound-file-path');

            if (! GLib.file_test(sound_f, GLib.FileTest.EXISTS)) {
                this.settings.set_string('alarms-sound-file-path',
                    GLib.filename_to_uri(ME.path + '/data/sounds/beeps.ogg', null));
            }
        }
        this.builder.get_object('alarms-sound-chooser')
            .set_uri(this.settings.get_string('alarms-sound-file-path'), null);
        this.builder.get_object('alarms-sound-chooser')
            .connect('selection-changed', (widget) => {
                this.settings.set_string('alarms-sound-file-path', widget.get_uri());
            });

        this.builder.get_object('alarms-notif-style-combo')
            .set_active(this.settings.get_enum('alarms-notif-style'));
        this.builder.get_object('alarms-notif-style-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('alarms-notif-style', widget.get_active());
            });

        this.settings.bind(
            'alarms-play-sound',
            this.builder.get_object('alarms-play-sound-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('alarms-keybinding-open')
            .set_text(this.settings.get_strv('alarms-keybinding-open')[0]);
        this.builder.get_object('alarms-keybinding-open')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('alarms-keybinding-open', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('alarms-keybinding-open', ['']);
                }
            });


        //
        // Todo and Time Tracker
        //
        this.settings.bind(
            'todo-separate-menu',
            this.builder.get_object('todo-separate-menu-switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('todo-panel-mode-combo')
            .set_active(this.settings.get_enum('todo-panel-mode'));
        this.builder.get_object('todo-panel-mode-combo')
            .connect('changed', (widget) => {
                this.settings.set_enum('todo-panel-mode', widget.get_active());
            });

        this.settings.bind(
            'todo-task-width',
            this.builder.get_object('todo-task-width-spin'),
            'value',
            Gio.SettingsBindFlags.DEFAULT);

        this.builder.get_object('todo-keybinding-open')
            .set_text(this.settings.get_strv('todo-keybinding-open')[0]);
        this.builder.get_object('todo-keybinding-open')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('todo-keybinding-open', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('todo-keybinding-open', ['']);
                }
            });

        this.builder.get_object('todo-keybinding-open-to-add')
            .set_text(this.settings.get_strv('todo-keybinding-open-to-add')[0]);
        this.builder.get_object('todo-keybinding-open-to-add')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('todo-keybinding-open-to-add', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('todo-keybinding-open-to-add', ['']);
                }
            });

        this.builder.get_object('todo-keybinding-open-to-search')
            .set_text(this.settings.get_strv('todo-keybinding-open-to-search')[0]);
        this.builder.get_object('todo-keybinding-open-to-search')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('todo-keybinding-open-to-search', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('todo-keybinding-open-to-search', ['']);
                }
            });

        this.builder.get_object('todo-keybinding-open-to-stats')
            .set_text(this.settings.get_strv('todo-keybinding-open-to-stats')[0]);
        this.builder.get_object('todo-keybinding-open-to-stats')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('todo-keybinding-open-to-stats', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('todo-keybinding-open-to-stats', ['']);
                }
            });

        this.builder.get_object('todo-keybinding-open-to-switch-files')
            .set_text(this.settings.get_strv('todo-keybinding-open-to-switch-files')[0]);
        this.builder.get_object('todo-keybinding-open-to-switch-files')
            .connect('changed', (entry) => {
                let [key, mods] = Gtk.accelerator_parse(entry.get_text());

                if (Gtk.accelerator_valid(key, mods)) {
                    entry["secondary-icon-name"] = null;
                    let shortcut = Gtk.accelerator_name(key, mods);
                    this.settings.set_strv('todo-keybinding-open-to-switch-files', [shortcut]);
                }
                else {
                    if (entry.get_text() !== '')
                        entry["secondary-icon-name"] = "dialog-warning-symbolic";
                    else
                        entry["secondary-icon-name"] = "";
                    this.settings.set_strv('todo-keybinding-open-to-switch-files', ['']);
                }
            });

        let todo_files = this.settings.get_value('todo-files').deep_unpack();
        for (let i = 0; i < todo_files.length; i++) {
            let row = this.list_store.append();
            let it  = todo_files[i];

            this.list_store.set_value(row, 0, it.name);
            this.list_store.set_value(row, 1, it.todo_file);
            this.list_store.set_value(row, 2, it.done_file);
            this.list_store.set_value(row, 3, it.csv_dir);
        }
    },
});

function init () {}

function buildPrefsWidget () {
    let settings = new Settings();
    let widget = settings.widget;
    widget.show_all();
    return widget;
}
