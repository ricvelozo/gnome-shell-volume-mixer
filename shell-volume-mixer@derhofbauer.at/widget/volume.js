/**
 * Shell Volume Mixer
 *
 * Volume widgets.
 *
 * @author Alexander Hofbauer <alex@derhofbauer.at>
 */

/* exported MasterSlider, OutputSlider, EventsSlider, InputSlider, InputStreamSlider */

const Clutter = imports.gi.Clutter;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Volume = imports.ui.status.volume;

const FloatingLabel = Extension.imports.widget.floatingLabel.FloatingLabel;
const MenuItem = Extension.imports.widget.menuItem;
const Settings = Extension.imports.settings;
const Slider = Extension.imports.widget.slider;


/**
 * Basic StreamSlider implementation for Input- and OutputStreams.
 *
 * We can extend (and monkey patch) Volume.OutputStreamSlider because
 * Volume.InputStreamSlider is meant for microphones only.
 */
const StreamSlider = new Lang.Class({
    Name: 'OutputStreamSlider',
    Extends: Volume.OutputStreamSlider,

    _init: function(control, options) {
        this.options = options || {};
        this._control = control;
        this._mixer = options.mixer;

        if (!this.item) {
            this.item = new MenuItem.SubMenuItem({ activate: false });
        }

        if (this.icon) {
            // different widgets seem to use different naming
            this._icon = this.icon;
        }

        if (!this._icon) {
            this._icon = new St.Icon({ style_class: 'popup-menu-icon' });
            this.item.firstLine.add(this._icon);
        }

        if (!this._label) {
            this._label = new St.Label({ text: '' });
            this.item.firstLine.add(this._label, { expand: true });
        }

        if (!this._slider) {
            this._slider = new Slider.VolumeSlider(0, this._mixer.getNormalizedStep());
            this.item.secondLine.add(this._slider.actor, { expand: true });
        }

        this._volumeInfo = new FloatingLabel();

        this._slider.connect('value-changed', Lang.bind(this, this._sliderChanged));
        this._slider.connect('drag-end', Lang.bind(this, this._notifyVolumeChange));

        if (this._onButtonPress) {
            this.item.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        }

        if (this._onKeyPress) {
            this.item.actor.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        }

        if (this._slider._onScrollEvent) {
            this.item.actor.connect('scroll-event', Lang.bind(this._slider, this._slider._onScrollEvent));
        }

        this.stream = options.stream || null;
    },

    _onKeyPress: function(actor, event) {
        return this._slider.onKeyPressEvent(actor, event);
    },

    _onButtonPress: function(actor, event) {
        if (event.get_button() == 2) {
            this._stream.change_is_muted(!this._stream.is_muted);
            return Clutter.EVENT_STOP;
        }
        return this._slider.startDragging(event);
    },

    refresh: function() {
        this._updateLabel();
        this._updateSliderIcon();
    },

    _updateSliderIcon: function() {
        if (this._stream && !this.options.symbolicIcons) {
            this._icon.gicon = this._stream.get_gicon();
        } else {
            this.parent();
        }

        this.emit('stream-updated');
    },

    _connectStream: function(stream) {
        this.parent(stream);
        this.refresh();
    },

    _updateLabel: function() {
        this._label.text = this._stream.name || this._stream.description || '';
    },

    _sliderChanged: function(slider, value, event) {
        if (!this._stream) {
            return;
        }

        let max = this._mixer.getVolMax();
        let newVol = max * value;
        this._mixer.setStreamVolume(this._stream, newVol);

        if (!this._volumeInfo) {
            return;
        }

        let percent = Math.round(newVol / this._control.get_vol_max_norm() * 100);
        this._showVolumeInfo(percent, event);
    },

    _updateVolume: function() {
        let muted = this._stream.is_muted;
        let max = this._mixer.getVolMax();

        this._slider.setValue(muted ? 0 : (this._stream.volume / max));
        this.emit('stream-updated');
    },

    _showVolumeInfo: function(value, event) {
        this._volumeInfo.text = value + '%';

        if (this._labelTimeoutId) {
            Mainloop.source_remove(this._labelTimeoutId);
            this._labelTimeoutId = undefined;
        }

        if (!this._infoShowing) {
            this._infoShowing = true;

            let x, y;

            if (event && 'showInfoAtMouseCursor' in event && event.showInfoAtMouseCursor === true) {
                [x, y] = event.get_coords();
                let [w, h] = this._volumeInfo.size;
                x += 15;
                y += h + 10;
            } else {
                [x, y] = this._slider.actor.get_transformed_position();
                x = x + Math.floor(this._slider.actor.get_width() / 2);
            }

            this._volumeInfo.show(x, y);
        }

        this._labelTimeoutId = Mainloop.timeout_add(1000, Lang.bind(this, function() {
            this._infoShowing = false;
            this._labelTimeoutId = undefined;
            this._volumeInfo.hide();
            return GLib.SOURCE_REMOVE;
        }));
    },

    hideVolumeInfo: function() {
        if (this._labelTimeoutId) {
            Mainloop.source_remove(this._labelTimeoutId);
            this._labelTimeoutId = undefined;
        }

        this._infoShowing = false;
        this._volumeInfo.hide(false);
    }
});



/**
 * Slider replacing the master volume slider.
 */
var MasterSlider = new Lang.Class({
    Name: 'MasterSlider',
    Extends: StreamSlider,

    _init: function(control, options) {
        this.item = new MenuItem.MasterMenuItem(options.mixer.getNormalizedStep());

        this._slider = this.item._slider;
        this._icon = this.item.icon;
        this._label = this.item.label;

        this.parent(control, options);
        this._slider.actor.accessible_name = _('Volume');

        this.item.menu.addAction(_('Settings'), Lang.bind(this, function () {
            Settings.openDialog();
        }));
    },

    addSliderItem: function (item) {
        let pos = (this.item.menu._getMenuItems().length || 0) - 1;

        this.item.menu.addMenuItem(item, pos < 0 ? 0 : pos);
    },

    /**
     * Override button click to allow for mute / unmute and menu to be opened.
     */
    _onButtonPress: function(actor, event) {
        if (event.get_button() == 2) {
            this._stream.change_is_muted(!this._stream.is_muted);
        }
        return Clutter.EVENT_STOP;
    },

    _updateLabel: function() {
        this._label.text = this._stream.description;
    },

    /**
     * Mouse scroll event triggered by scrolling over panel icon.
     */
    scroll: function(event) {
        event.showInfoAtMouseCursor = !Main.panel.statusArea.aggregateMenu.menu.isOpen;
        return this._slider.scroll(event);
    }
});


/**
 * Menu item for aggregated input streams.
 */
var AggregatedInput = new Lang.Class({
    Name: 'AggregatedInput',

    _init: function() {
        this.item = new PopupMenu.PopupSubMenuMenuItem(_('Inputs'), true);
        this.item.icon.icon_name = 'applications-multimedia-symbolic';
        this.item.actor.accessible_name = _('Inputs');

        this._inputStream = null;
    },

    setInputStream: function(inputSlider) {
        this._inputStream = inputSlider;
        this.addSlider(inputSlider, 0);
    },

    addSlider: function (slider, pos) {
        this.item.menu.addMenuItem(slider.item, pos || undefined);

        slider.connect('stream-updated', Lang.bind(this, function () {
            this.refresh();
        }));
    },

    refresh: function() {
        let hasVisibleItems = (this.item.menu.numMenuItems > 1
            || (this.item.menu.numMenuItems > 0 && this._inputStream.isVisible())
        );

        this.item.actor.visible = hasVisibleItems;
    }
});



/**
 * Slider for output sinks (e.g. alsa devices, different profiles).
 */
var OutputSlider = new Lang.Class({
    Name: 'OutputSlider',
    Extends: StreamSlider,

    _init: function(control, options) {
        if (options.detailed) {
            this._details = new St.Label({ text: '', style_class: 'svm-slider-details' });
        }

        this.parent(control, options);

        if (options.detailed) {
            this.item.addChildAt(this._details, 1);
        }
    },

    _onButtonPress: function(actor, event) {
        if (event.get_button() == 1) {
            this._setAsDefault();
            return Clutter.EVENT_PROPAGATE;
        }
        return this.parent(actor, event);
    },

    _onKeyPress: function(actor, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.KEY_space || symbol == Clutter.KEY_Return) {
            this._setAsDefault();
            return Clutter.EVENT_STOP;
        }

        return this.parent(actor, event);
    },

    _updateLabel: function() {
        let text = this._stream.description;
        let description = this._stream.name;

        this._label.text = text;

        if (this.options.detailed && text != description && description) {
            let parts = description.split('.');

            if (parts.length > 1) {
                if (parts[0] == 'alsa_output') {
                    // remove the common first (and uninteresting) part
                    parts.shift();
                }
                // the last segment of the path is the most interesting one
                description = parts.pop();
                description += ' | ' + parts.join('.');
            }

            this._details.text = description;
        }
    },

    setSelected: function(selected) {
        if (selected !== false) {
            this.item.setSelected(true);
            this._label.add_style_class_name('selected-stream');
        } else {
            this.item.setSelected(false);
            this._label.remove_style_class_name('selected-stream');
        }
    },

    _setAsDefault: function() {
        this._control.set_default_sink(this._stream);
    }
});


/**
 * Slider for system sounds.
 */
var EventsSlider = new Lang.Class({
    Name: 'EventsSlider',
    Extends: StreamSlider,

    _updateLabel: function() {
        this._label.text = this._stream.name;
    }
});


/**
 * Slider for input sinks (e.g. media players).
 */
var InputSlider = new Lang.Class({
    Name: 'InputSlider',
    Extends: StreamSlider,

    _updateLabel: function() {
        let text = this._stream.name;
        let description = this._stream.description;

        if (description && text != description) {
            if (text) {
                text = description + ' | ' + text;
            } else {
                text = description;
            }
        }

        this._label.text = text || '[' + _('unknown') + ']';
    }
});


/**
 * Input stream slider (microphones, etc ?).
 */
var InputStreamSlider = new Lang.Class({
    Name: 'InputStreamSlider',
    Extends: StreamSlider,

    _init: function(control, options) {
        this.parent(control, options);

        this._slider.actor.accessible_name = _('Microphone');
        this._control.connect('stream-added', Lang.bind(this, this._maybeShowInput));
        this._control.connect('stream-removed', Lang.bind(this, this._maybeShowInput));
    },

    _connectStream: function(stream) {
        this.parent(stream);
        this._maybeShowInput();
    },

    _maybeShowInput: function() {
        if (this.options.showAlways === true) {
            this._showInput = true;
            this._updateVisibility();
        } else {
            Volume.InputStreamSlider.prototype._maybeShowInput.call(this);
        }
    },

    isVisible: function() {
        return this._shouldBeVisible();
    },

    _shouldBeVisible: function() {
        return Volume.InputStreamSlider.prototype._shouldBeVisible.call(this);
    },

    _updateLabel: function() {
        this.parent();

        this._label.text = _('Microphone');
    },

    _updateSliderIcon: function() {
        if (this._stream && !this.options.symbolicIcons) {
            this._icon.gicon = this._stream.get_gicon();
        } else {
            this._icon.icon_name = 'audio-input-microphone-symbolic';
        }

        this.emit('stream-updated');
    }
});


/**
 * Just re-declarations for now.
 */
var VolumeMenu = Volume.VolumeMenu;
